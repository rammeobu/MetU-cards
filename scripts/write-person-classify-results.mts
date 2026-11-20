/**
 * 인물 예시 분류 → results/index.html + classify.json
 * npx tsx scripts/write-person-classify-results.mts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { z } from "zod";

import { groupPhotoAlbums } from "../lib/trips/photo-albums";
import {
  PHOTO_CLASSIFY_SYSTEM,
  PhotoClassifyBatchSchema,
  applyClassifyItem,
} from "../lib/trips/photo-classify";

function loadEnvLocal(): void {
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(
    /\r?\n/
  )) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

loadEnvLocal();
const key = process.env.OPENAI_API_KEY?.trim();
if (!key) {
  console.error("OPENAI_API_KEY missing");
  process.exit(1);
}

const dir = join(process.cwd(), "tmp/person-photos/trio-examples");
const outDir = join(dir, "results");
mkdirSync(outDir, { recursive: true });

const files = readdirSync(dir)
  .filter((n) => /\.jpe?g$/i.test(n))
  .sort();
const model = process.env.OPENAI_MODEL_MAIN?.trim() || "gpt-6-luna";
const client = new OpenAI({ apiKey: key });

const images = files.map((name) => ({
  name,
  base64: readFileSync(join(dir, name)).toString("base64"),
}));

const content: OpenAI.Chat.ChatCompletionContentPart[] = [
  {
    type: "text",
    text: `이미지 ${images.length}장을 index 0부터 순서대로 분류하세요. 파일: ${files.join(", ")}`,
  },
  ...images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:image/jpeg;base64,${img.base64}` },
  })),
];

const jsonSchema = z.toJSONSchema(PhotoClassifyBatchSchema) as Record<
  string,
  unknown
>;
const { $schema: _s, ...schema } = jsonSchema;

const completion = await client.chat.completions.create({
  model,
  messages: [
    { role: "system", content: PHOTO_CLASSIFY_SYSTEM },
    { role: "user", content },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "metu_photo_classify",
      strict: false,
      schema,
    },
  },
  reasoning_effort: "none",
});

const text = completion.choices[0]?.message?.content?.trim() ?? "";
const validated = PhotoClassifyBatchSchema.parse(JSON.parse(text));
const rows = validated.items
  .slice()
  .sort((a, b) => a.index - b.index)
  .map((item) => {
    const applied = applyClassifyItem(item);
    return {
      file: files[item.index] ?? "?",
      index: item.index,
      ...applied,
    };
  });

const albums = groupPhotoAlbums(
  rows.map((r) => ({
    id: r.file,
    status: "ready" as const,
    scene: r.scene,
    personKeys: r.personKeys,
  }))
);

const result = {
  model,
  at: new Date().toISOString(),
  rows,
  albums: albums.map((a) => ({
    label: a.label,
    photoIds: a.photoIds,
  })),
};

writeFileSync(join(outDir, "classify.json"), JSON.stringify(result, null, 2));

const albumHtml = albums
  .map(
    (s) => `
  <section>
    <h2>${esc(s.label)} <span class="n">${s.photoIds.length}장</span></h2>
    <div class="grid">
      ${s.photoIds
        .map(
          (id) =>
            `<figure><img src="../${esc(id)}" alt=""/><figcaption>${esc(id)}</figcaption></figure>`
        )
        .join("")}
    </div>
  </section>`
  )
  .join("\n");

const tableRows = rows
  .map(
    (r) =>
      `<tr><td>${esc(r.file)}</td><td>${esc(r.scene)}</td><td>${esc(r.personKeys.join(", "))}</td></tr>`
  )
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>여행 사진 분류 결과</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;background:#F7F8FA;color:#111;padding:24px;max-width:960px}
  h1{font-size:22px;margin:0 0 8px}
  .meta{color:#667;font-size:13px;margin-bottom:24px}
  section{background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:16px;margin-bottom:16px}
  h2{font-size:16px;margin:0 0 12px}
  .n{color:#667;font-weight:600;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
  figure{margin:0}
  img{width:100%;aspect-ratio:1;object-fit:contain;background:#F7F8FA;border-radius:12px;border:1px solid #E5E7EB;display:block}
  figcaption{font-size:11px;color:#667;margin-top:4px;word-break:break-all}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:10px 12px;border-bottom:1px solid #E5E7EB;text-align:left}
  th{background:#F3F4F6}
</style>
</head>
<body>
<h1>여행 사진 분류 결과</h1>
<p class="meta">${esc(result.at)} · ${esc(model)} · ${rows.length}장</p>
${albumHtml}
<section>
  <h2>원본 표</h2>
  <table>
    <thead><tr><th>파일</th><th>scene</th><th>personKeys</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</section>
</body>
</html>`;

writeFileSync(join(outDir, "index.html"), html);
console.log(
  JSON.stringify(
    {
      out: outDir,
      albums: albums.map((a) => ({ label: a.label, n: a.photoIds.length })),
      rows,
    },
    null,
    2
  )
);
