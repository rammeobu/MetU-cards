import { NextResponse } from "next/server";

import { geminiVision } from "@/lib/ai/gemini";
import { TABLES } from "@/lib/constants";
import { guardApi, rejectAnonymousWrite } from "@/lib/security/guard";
import {
  applyClassifyItem,
  MAX_CLASSIFY_BATCH,
  PHOTO_CLASSIFY_SYSTEM,
  PhotoClassifyBatchSchema,
  TRIP_PHOTO_BUCKET,
} from "@/lib/trips/photo-classify";
import { requireTripPhotoAccess } from "@/lib/trips/photo-server";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

type PhotoRow = {
  id: string;
  storage_path: string;
  status: string;
};

function mimeFromPath(path: string): string {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/** pending/failed 사진을 배치로 Gemini 분류 */
export async function POST(request: Request, ctx: Ctx) {
  const guard = await guardApi(request, { bucket: "ledger-vision" });
  if (guard instanceof NextResponse) return guard;
  if (guard.identity.kind !== "user") {
    return NextResponse.json({ error: "login-required" }, { status: 401 });
  }
  const anon = rejectAnonymousWrite(guard.identity);
  if (anon) return anon;

  const { id: tripId } = await ctx.params;
  const gate = await requireTripPhotoAccess(tripId, guard.identity.userId);
  if (!gate.ok) return gate.response;

  let includeOther = false;
  try {
    const body = (await request.clone().json()) as { includeOther?: unknown };
    includeOther = body?.includeOther === true;
  } catch {
    includeOther = false;
  }

  // 기타로만 묶인 사진을 다시 분류 (동물 등). 요청 시에만 — 매번 되돌리면 무한 재분류됨.
  if (includeOther) {
    const { error: requeueErr } = await gate.supabase
      .from(TABLES.tripPhotos)
      .update({
        status: "pending",
        scene: null,
        person_keys: [],
        error: null,
      })
      .eq("trip_id", tripId)
      .eq("status", "ready")
      .eq("scene", "other");
    if (requeueErr) {
      console.error("[api/trips/photos/classify] requeue", requeueErr.message);
    }
  }

  const { data, error } = await gate.supabase
    .from(TABLES.tripPhotos)
    .select("id, storage_path, status")
    .eq("trip_id", tripId)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(MAX_CLASSIFY_BATCH);

  if (error) {
    console.error("[api/trips/photos/classify] list", error.message);
    return NextResponse.json({ error: "list-failed" }, { status: 500 });
  }

  const rows = (data ?? []) as PhotoRow[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, classified: 0, failed: 0 });
  }

  const images: Array<{ mimeType: string; base64: string }> = [];
  const loaded: PhotoRow[] = [];

  for (const row of rows) {
    const { data: blob, error: dlErr } = await gate.supabase.storage
      .from(TRIP_PHOTO_BUCKET)
      .download(row.storage_path);
    if (dlErr || !blob) {
      console.error("[api/trips/photos/classify] download", dlErr?.message);
      await gate.supabase
        .from(TABLES.tripPhotos)
        .update({
          status: "failed",
          error: "사진을 불러오지 못했어요",
        })
        .eq("id", row.id);
      continue;
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    images.push({
      mimeType: mimeFromPath(row.storage_path),
      base64: buf.toString("base64"),
    });
    loaded.push(row);
  }

  if (loaded.length === 0) {
    return NextResponse.json({
      ok: true,
      classified: 0,
      failed: rows.length,
    });
  }

  const result = await geminiVision({
    system: PHOTO_CLASSIFY_SYSTEM,
    text: `이미지 ${loaded.length}장을 index 0부터 순서대로 분류하세요.`,
    images,
    schema: PhotoClassifyBatchSchema,
    purpose: "trip_photo_classify",
    userId: guard.identity.userId,
    tripId,
  });

  if (!result.ok) {
    const message =
      result.error === "no_api_key"
        ? "AI 키가 없어요. OPENAI_API_KEY · XAI_API_KEY · GEMINI_API_KEY 중 하나를 .env.local 에 넣고 서버를 재시작해 주세요."
        : result.error === "quota_exhausted"
          ? "오늘 AI 무료 한도를 다 썼어요. XAI_API_KEY 또는 OPENAI_API_KEY 를 넣거나 내일 다시 시도해 주세요."
          : result.error === "image_too_large"
            ? "사진이 너무 커요"
            : "사진 분류에 실패했어요";
    console.error("[api/trips/photos/classify] gemini", result.error);
    await Promise.all(
      loaded.map((row) =>
        gate.supabase
          .from(TABLES.tripPhotos)
          .update({ status: "failed", error: message })
          .eq("id", row.id)
      )
    );
    return NextResponse.json({
      ok: false,
      error: result.error,
      message,
      classified: 0,
      failed: loaded.length,
    });
  }

  const byIndex = new Map(
    result.data.items.map((item) => [item.index, item] as const)
  );
  let classified = 0;
  let failed = 0;

  for (let i = 0; i < loaded.length; i += 1) {
    const row = loaded[i]!;
    const item = byIndex.get(i);
    if (!item) {
      failed += 1;
      await gate.supabase
        .from(TABLES.tripPhotos)
        .update({
          status: "failed",
          error: "분류 결과가 없어요",
        })
        .eq("id", row.id);
      continue;
    }
    const applied = applyClassifyItem(item);
    const { error: upErr } = await gate.supabase
      .from(TABLES.tripPhotos)
      .update({
        status: "ready",
        scene: applied.scene,
        person_keys: applied.personKeys,
        error: null,
      })
      .eq("id", row.id);
    if (upErr) {
      failed += 1;
      console.error("[api/trips/photos/classify] update", upErr.message);
    } else {
      classified += 1;
    }
  }

  return NextResponse.json({ ok: true, classified, failed });
}
