import "server-only";

import OpenAI from "openai";
import { z } from "zod";

import { getUsageSink } from "@/lib/ai/usage";

export type GeminiModelKind = "fast" | "main";

type GeminiOk<T> = {
  ok: true;
  data: T;
  model: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
};

type GeminiErr = {
  ok: false;
  error: string;
  reason?: string;
  model?: string;
  ms?: number;
};

export type GeminiResult<T> = GeminiOk<T> | GeminiErr;

type InteractionLike = {
  id: string;
  output_text?: string;
  steps?: Array<{
    type: string;
    name?: string;
    id?: string;
    arguments?: Record<string, unknown>;
  }>;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
  };
};

type CreateParams = Record<string, unknown>;

/**
 * Test seam — mocks use the same shape as the OpenAI adapter
 * (`interactions.create` → InteractionLike).
 */
export type GeminiInteractionsClient = {
  interactions: {
    create: (
      params: CreateParams,
      options?: { timeout?: number; abortSignal?: AbortSignal }
    ) => Promise<InteractionLike>;
  };
};

const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;

let clientOverride: GeminiInteractionsClient | null = null;

export function setGeminiClientForTests(
  client: GeminiInteractionsClient | null
): void {
  clientOverride = client;
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? "");
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

type LlmProvider = "openai" | "xai" | "gemini";

function resolveProvider(): LlmProvider {
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  // Gemini free tier 소진 시 프론트 분류용으로 Grok 우선.
  if (process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim()) {
    return "xai";
  }
  return "gemini";
}

function defaultModel(provider: LlmProvider): string {
  if (provider === "openai") return "gpt-6-luna";
  if (provider === "xai") return "grok-4.7"; // VERIFY: xAI vision-capable chat model
  return "gemini-3.8-flash";
}

/** OpenAI / Grok / Gemini 기본 모델 (env로 덮어쓰기). */
function modelName(kind: GeminiModelKind): string {
  const provider = resolveProvider();
  if (kind === "main") {
    if (process.env.OPENAI_MODEL_MAIN?.trim()) {
      return process.env.OPENAI_MODEL_MAIN.trim();
    }
    if (process.env.XAI_MODEL_MAIN?.trim()) {
      return process.env.XAI_MODEL_MAIN.trim();
    }
    if (process.env.GEMINI_MODEL_MAIN?.trim()) {
      return process.env.GEMINI_MODEL_MAIN.trim();
    }
    return defaultModel(provider);
  }
  if (process.env.OPENAI_MODEL_FAST?.trim()) {
    return process.env.OPENAI_MODEL_FAST.trim();
  }
  if (process.env.XAI_MODEL_FAST?.trim()) {
    return process.env.XAI_MODEL_FAST.trim();
  }
  if (process.env.GEMINI_MODEL_FAST?.trim()) {
    return process.env.GEMINI_MODEL_FAST.trim();
  }
  return defaultModel(provider);
}

function timeoutMs(): number {
  return envInt("OPENAI_TIMEOUT_MS", envInt("GEMINI_TIMEOUT_MS", 25_000));
}

function maxRetries(): number {
  return envInt("OPENAI_MAX_RETRIES", envInt("GEMINI_MAX_RETRIES", 2));
}

function dailyCap(): number {
  return envInt("AGENT_DAILY_LLM_CALLS", 200);
}

function getApiKey(): string | null {
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai) return openai;
  const xai =
    process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim();
  if (xai) return xai;
  const gemini = process.env.GEMINI_API_KEY?.trim();
  return gemini || null;
}

/** OpenAI 기본 / xAI·Gemini 는 OpenAI 호환 baseURL. */
function openAiBaseURL(): string | undefined {
  const explicit = process.env.OPENAI_BASE_URL?.trim();
  if (explicit) return explicit;
  if (process.env.OPENAI_API_KEY?.trim()) return undefined;
  if (process.env.XAI_API_KEY?.trim() || process.env.GROK_API_KEY?.trim()) {
    return "https://api.x.ai/v1";
  }
  if (process.env.GEMINI_API_KEY?.trim()) {
    return "https://generativelanguage.googleapis.com/v1beta/openai/";
  }
  return undefined;
}

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _s, ...rest } = raw;
  return rest;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorStatus(err: unknown): number | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 일일 무료 한도 등은 재시도해도 안 풀림. */
function isDailyQuotaExhausted(err: unknown): boolean {
  const msg = errorText(err);
  return /free.?tier|per.?day|quota.?exceeded|RESOURCE_EXHAUSTED|GenerateRequestsPerDay/i.test(
    msg
  );
}

function isRetryableStatus(err: unknown): boolean {
  if (isDailyQuotaExhausted(err)) return false;
  const status = errorStatus(err);
  if (status === 429 || (status !== null && status >= 500)) return true;
  return /\b429\b|rate.?limit|unavailable|timeout|5\d\d/i.test(errorText(err));
}

/** API 라우트가 사용자 메시지로 매핑할 수 있게 정규화. */
export function normalizeLlmError(err: unknown): string {
  if (isDailyQuotaExhausted(err) || errorStatus(err) === 429) {
    return "quota_exhausted";
  }
  return err instanceof Error ? err.message : "openai_error";
}

async function withRetries<T>(
  fn: (attempt: number) => Promise<T>
): Promise<T> {
  const retries = maxRetries();
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      if (attempt >= retries || !isRetryableStatus(err)) throw err;
      await sleep(Math.min(4000, 400 * 2 ** attempt));
    }
  }
  throw last;
}

async function guardDaily(userId: string): Promise<GeminiErr | null> {
  const sink = getUsageSink();
  const used = await sink.countToday(userId);
  if (used >= dailyCap()) {
    return { ok: false, error: "daily_llm_cap" };
  }
  return null;
}

async function recordUsage(args: {
  userId: string;
  tripId?: string;
  model: string;
  purpose: string;
  ms: number;
  ok: boolean;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  try {
    await getUsageSink().record({
      userId: args.userId,
      tripId: args.tripId ?? null,
      model: args.model,
      purpose: args.purpose,
      inputTokens: args.inputTokens ?? null,
      outputTokens: args.outputTokens ?? null,
      ms: args.ms,
      ok: args.ok,
    });
  } catch {
    // usage logging must not break agent path
  }
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildUserContent(
  input: unknown
): string | ContentPart[] {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return String(input ?? "");

  const parts: ContentPart[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type === "text" && typeof row.text === "string") {
      parts.push({ type: "text", text: row.text });
      continue;
    }
    if (row.type === "image") {
      const data = typeof row.data === "string" ? row.data : "";
      const mime =
        typeof row.mime_type === "string" ? row.mime_type : "image/jpeg";
      if (!data) continue;
      parts.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${data}` },
      });
    }
  }
  if (parts.length === 0) return "";
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
}

function buildOpenAiClient(): GeminiInteractionsClient {
  const key = getApiKey();
  if (!key) {
    throw new Error("no_api_key");
  }
  const baseURL = openAiBaseURL();
  const openai = new OpenAI({
    apiKey: key,
    ...(baseURL ? { baseURL } : {}),
  });
  const provider = resolveProvider();

  return {
    interactions: {
      create: async (params, options) => {
        const model = String(params.model ?? defaultModel(provider));
        const system =
          typeof params.system_instruction === "string"
            ? params.system_instruction
            : "";
        const userContent = buildUserContent(params.input);
        const responseFormat = params.response_format as
          | {
              type?: string;
              mime_type?: string;
              schema?: Record<string, unknown>;
            }
          | undefined;

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
        if (system.trim()) {
          messages.push({ role: "system", content: system });
        }
        messages.push({ role: "user", content: userContent });

        let format: OpenAI.Chat.ChatCompletionCreateParams["response_format"];
        const wantsJson =
          responseFormat?.mime_type === "application/json" ||
          responseFormat?.type === "json_object" ||
          Boolean(responseFormat?.schema);

        if (responseFormat?.schema && wantsJson) {
          format = {
            type: "json_schema",
            json_schema: {
              name: "metu_schema",
              strict: false,
              schema: responseFormat.schema,
            },
          };
        } else if (wantsJson) {
          format = { type: "json_object" };
        }

        // gpt-6-luna: reasoning_effort=none 이 structured 경로에 안정적.
        // Gemini OpenAI 호환 엔드포인트는 reasoning_effort 를 안 받아요.
        const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
          model,
          messages,
          stream: false,
          ...(format ? { response_format: format } : {}),
          ...(provider === "openai" ? { reasoning_effort: "none" as const } : {}),
        };
        const completion = (await openai.chat.completions.create(body, {
          signal: options?.abortSignal,
          timeout: options?.timeout ?? timeoutMs(),
        })) as OpenAI.Chat.ChatCompletion;

        const text = completion.choices[0]?.message?.content?.trim() ?? "";
        return {
          id: completion.id,
          output_text: text,
          usage: {
            total_input_tokens: completion.usage?.prompt_tokens,
            total_output_tokens: completion.usage?.completion_tokens,
          },
        };
      },
    },
  };
}

function getClient(): GeminiInteractionsClient | null {
  if (clientOverride) return clientOverride;
  if (!getApiKey()) return null;
  return buildOpenAiClient();
}

async function createInteraction(
  client: GeminiInteractionsClient,
  params: CreateParams,
  callTimeoutMs?: number
): Promise<InteractionLike> {
  const ms = callTimeoutMs && callTimeoutMs > 0 ? callTimeoutMs : timeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await client.interactions.create(params, {
      timeout: ms,
      abortSignal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function geminiText(args: {
  model: GeminiModelKind;
  system: string;
  input: string;
  purpose: string;
  userId: string;
  tripId?: string;
  /** Prefer JSON-only replies (no markdown fences). */
  json?: boolean;
  /** Insight mode 등에서 넘기는 호출별 타임아웃(ms). */
  timeoutMs?: number;
  /** Optional inline images (receipt vision etc.). */
  images?: Array<{ mimeType: string; base64: string }>;
}): Promise<GeminiResult<string>> {
  const started = Date.now();
  const model = modelName(args.model);
  const client = getClient();
  if (!client) {
    return { ok: false, error: "no_api_key", model };
  }

  if (args.images?.length) {
    for (const img of args.images) {
      const bytes = Math.floor((img.base64.length * 3) / 4);
      if (bytes > MAX_INLINE_IMAGE_BYTES) {
        return { ok: false, error: "image_too_large", model };
      }
    }
  }

  const cap = await guardDaily(args.userId);
  if (cap) return { ...cap, model };

  const system = args.json
    ? `${args.system}\n\n[출력] JSON만 출력하세요. 마크다운 코드펜스 금지.`
    : args.system;

  const input: string | Array<Record<string, unknown>> =
    args.images?.length
      ? [
          { type: "text", text: args.input },
          ...args.images.map((img) => ({
            type: "image",
            data: img.base64,
            mime_type: img.mimeType,
          })),
        ]
      : args.input;

  const callTimeout = args.timeoutMs;

  try {
    const interaction = await withRetries(() =>
      createInteraction(
        client,
        {
          model,
          store: false,
          system_instruction: system,
          input,
          response_format: args.json
            ? { type: "text", mime_type: "application/json" }
            : { type: "text" },
        },
        callTimeout
      )
    );

    const text = interaction.output_text?.trim() ?? "";
    const ms = Date.now() - started;
    const inputTokens = interaction.usage?.total_input_tokens;
    const outputTokens = interaction.usage?.total_output_tokens;

    if (!text) {
      await recordUsage({
        userId: args.userId,
        tripId: args.tripId,
        model,
        purpose: args.purpose,
        ms,
        ok: false,
        inputTokens,
        outputTokens,
      });
      return { ok: false, error: "empty", model, ms };
    }

    await recordUsage({
      userId: args.userId,
      tripId: args.tripId,
      model,
      purpose: args.purpose,
      ms,
      ok: true,
      inputTokens,
      outputTokens,
    });

    return {
      ok: true,
      data: text,
      model,
      ms,
      inputTokens,
      outputTokens,
    };
  } catch (err) {
    const ms = Date.now() - started;
    await recordUsage({
      userId: args.userId,
      tripId: args.tripId,
      model,
      purpose: args.purpose,
      ms,
      ok: false,
    });
    return {
      ok: false,
      error: normalizeLlmError(err),
      model,
      ms,
    };
  }
}

export async function geminiStructured<T>(args: {
  model: GeminiModelKind;
  system: string;
  input: string;
  schema: z.ZodType<T>;
  purpose: string;
  userId: string;
  tripId?: string;
}): Promise<GeminiResult<T>> {
  const started = Date.now();
  const model = modelName(args.model);
  const client = getClient();
  if (!client) {
    return { ok: false, error: "no_api_key", model };
  }

  const cap = await guardDaily(args.userId);
  if (cap) return { ...cap, model };

  const jsonSchema = zodToJsonSchema(args.schema);

  const runOnce = async (extraHint?: string): Promise<GeminiResult<T>> => {
    const inputText = extraHint
      ? `${args.input}\n\n[Correction]\n${extraHint}`
      : args.input;

    const interaction = await withRetries(() =>
      createInteraction(client, {
        model,
        store: false,
        system_instruction: args.system,
        input: inputText,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: jsonSchema,
        },
      })
    );

    const text = interaction.output_text?.trim() ?? "";
    const ms = Date.now() - started;
    const inputTokens = interaction.usage?.total_input_tokens;
    const outputTokens = interaction.usage?.total_output_tokens;

    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      await recordUsage({
        userId: args.userId,
        tripId: args.tripId,
        model,
        purpose: args.purpose,
        ms,
        ok: false,
        inputTokens,
        outputTokens,
      });
      return { ok: false, error: "invalid_json", model, ms };
    }

    const validated = args.schema.safeParse(parsed);
    if (!validated.success) {
      await recordUsage({
        userId: args.userId,
        tripId: args.tripId,
        model,
        purpose: args.purpose,
        ms,
        ok: false,
        inputTokens,
        outputTokens,
      });
      return {
        ok: false,
        error: "zod_failed",
        reason: validated.error.message,
        model,
        ms,
      };
    }

    await recordUsage({
      userId: args.userId,
      tripId: args.tripId,
      model,
      purpose: args.purpose,
      ms,
      ok: true,
      inputTokens,
      outputTokens,
    });

    return {
      ok: true,
      data: validated.data,
      model,
      ms,
      inputTokens,
      outputTokens,
    };
  };

  try {
    const first = await runOnce();
    if (first.ok) return first;
    if (first.error === "zod_failed" || first.error === "invalid_json") {
      const second = await runOnce(
        `이전 응답이 스키마와 맞지 않았습니다. JSON만 출력하고 스키마를 정확히 지키세요. 오류: ${first.reason ?? first.error}`
      );
      return second;
    }
    return first;
  } catch (err) {
    const ms = Date.now() - started;
    await recordUsage({
      userId: args.userId,
      tripId: args.tripId,
      model,
      purpose: args.purpose,
      ms,
      ok: false,
    });
    return {
      ok: false,
      error: normalizeLlmError(err),
      model,
      ms,
    };
  }
}

export async function geminiVision<T>(args: {
  system: string;
  text?: string;
  images: Array<{ mimeType: string; base64: string }>;
  schema: z.ZodType<T>;
  purpose: string;
  userId: string;
  tripId?: string;
  model?: GeminiModelKind;
}): Promise<GeminiResult<T>> {
  const kind = args.model ?? "main";
  const started = Date.now();
  const model = modelName(kind);
  const client = getClient();
  if (!client) {
    return { ok: false, error: "no_api_key", model };
  }

  for (const img of args.images) {
    const bytes = Math.floor((img.base64.length * 3) / 4);
    if (bytes > MAX_INLINE_IMAGE_BYTES) {
      return { ok: false, error: "image_too_large", model };
    }
  }

  const cap = await guardDaily(args.userId);
  if (cap) return { ...cap, model };

  const jsonSchema = zodToJsonSchema(args.schema);
  const input: Array<Record<string, unknown>> = [];
  if (args.text?.trim()) {
    input.push({ type: "text", text: args.text.trim() });
  }
  for (const img of args.images) {
    input.push({
      type: "image",
      data: img.base64,
      mime_type: img.mimeType,
    });
  }

  try {
    const interaction = await withRetries(() =>
      createInteraction(client, {
        model,
        store: false,
        system_instruction: args.system,
        input,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: jsonSchema,
        },
      })
    );

    const text = interaction.output_text?.trim() ?? "";
    const ms = Date.now() - started;
    const inputTokens = interaction.usage?.total_input_tokens;
    const outputTokens = interaction.usage?.total_output_tokens;

    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      await recordUsage({
        userId: args.userId,
        tripId: args.tripId,
        model,
        purpose: args.purpose,
        ms,
        ok: false,
        inputTokens,
        outputTokens,
      });
      return { ok: false, error: "invalid_json", model, ms };
    }

    const validated = args.schema.safeParse(parsed);
    if (!validated.success) {
      await recordUsage({
        userId: args.userId,
        tripId: args.tripId,
        model,
        purpose: args.purpose,
        ms,
        ok: false,
        inputTokens,
        outputTokens,
      });
      return {
        ok: false,
        error: "zod_failed",
        reason: validated.error.message,
        model,
        ms,
      };
    }

    await recordUsage({
      userId: args.userId,
      tripId: args.tripId,
      model,
      purpose: args.purpose,
      ms,
      ok: true,
      inputTokens,
      outputTokens,
    });

    return {
      ok: true,
      data: validated.data,
      model,
      ms,
      inputTokens,
      outputTokens,
    };
  } catch (err) {
    const ms = Date.now() - started;
    await recordUsage({
      userId: args.userId,
      tripId: args.tripId,
      model,
      purpose: args.purpose,
      ms,
      ok: false,
    });
    return {
      ok: false,
      error: normalizeLlmError(err),
      model,
      ms,
    };
  }
}
