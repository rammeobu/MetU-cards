/**
 * 인물 샘플로 여행 사진 분류 스모크.
 *
 * Usage:
 *   npx tsx scripts/smoke-person-classify.mts
 *   npx tsx scripts/smoke-person-classify.mts --dir tmp/person-photos/trio-examples
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { z } from "zod";

import {
  PHOTO_CLASSIFY_SYSTEM,
  PhotoClassifyBatchSchema,
  applyClassifyItem,
} from "../lib/trips/photo-classify";
import { groupPhotoAlbums } from "../lib/trips/photo-albums";

function loadEnvLocal(): void {
  const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();

const key = process.env.OPENAI_API_KEY?.trim();
if (!key) {
  console.error("OPENAI_API_KEY missing");
  process.exit(1);
}

const dirArg = process.argv.includes("--dir")
  ? process.argv[process.argv.indexOf("--dir") + 1]
  : null;
const dir = join(process.cwd(), dirArg ?? "tmp/person-photos");
const files = readdirSync(dir)
  .filter((n) => /\.(jpe?g|png|webp)$/i.test(n))
  .sort();

if (files.length === 0) {
  console.error(`no images in ${dir}`);
  process.exit(1);
}

const model = process.env.OPENAI_MODEL_MAIN?.trim() || "gpt-6-luna";
const client = new OpenAI({ apiKey: key });

const images = files.map((name) => {
  const buf = readFileSync(join(dir, name));
  return {
    name,
    mimeType: "image/jpeg" as const,
    base64: buf.toString("base64"),
  };
});

const content: OpenAI.Chat.ChatCompletionContentPart[] = [
  {
    type: "text",
    text: `이미지 ${images.length}장을 index 0부터 순서대로 분류하세요. 파일 순서: ${files.join(", ")}`,
  },
  ...images.map((img) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${img.mimeType};base64,${img.base64}`,
    },
  })),
];

const jsonSchema = z.toJSONSchema(PhotoClassifyBatchSchema) as Record<
  string,
  unknown
>;
const { $schema: _s, ...schema } = jsonSchema;

console.log(`model=${model} dir=${dir}`);
console.log(`files=${files.join(",")}`);

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
let parsed: unknown;
try {
  parsed = JSON.parse(text);
} catch {
  console.error("invalid_json", text.slice(0, 500));
  process.exit(1);
}

const validated = PhotoClassifyBatchSchema.safeParse(parsed);
if (!validated.success) {
  console.error("zod_failed", validated.error.message);
  console.error(text.slice(0, 800));
  process.exit(1);
}

const rows = validated.data.items
  .slice()
  .sort((a, b) => a.index - b.index)
  .map((item) => {
    const applied = applyClassifyItem(item);
    const file = files[item.index] ?? "?";
    return { file, index: item.index, ...applied };
  });

console.log(JSON.stringify(rows, null, 2));

const albumRows = rows.map((r, i) => ({
  id: r.file,
  status: "ready" as const,
  scene: r.scene,
  personKeys: r.personKeys,
}));
const albums = groupPhotoAlbums(albumRows);
console.log(
  "albums=",
  JSON.stringify(
    albums.map((s) => ({ label: s.label, n: s.photoIds.length, ids: s.photoIds })),
    null,
    2
  )
);

const isTrioDir = dir.includes("trio-examples");
if (isTrioDir) {
  const byFile = new Map(rows.map((r) => [r.file, r]));
  // 솔로=1명 온전, 단체=2명+ → 앨범에서 사람N / 함께로 분리 (조각내지 않음)
  const solos = ["01_solo_a.jpg", "02_solo_b.jpg", "03_solo_c.jpg"];
  const groups = ["04_duo_ab.jpg", "05_duo_bc.jpg", "06_trio_abc.jpg"];
  let ok = true;
  for (const file of solos) {
    const row = byFile.get(file);
    if (!row || row.scene !== "person" || row.personKeys.length !== 1) {
      console.error(`FAIL solo ${file}:`, row);
      ok = false;
    } else {
      console.log(`OK solo ${file}: ${row.personKeys[0]}`);
    }
  }
  for (const file of groups) {
    const row = byFile.get(file);
    if (!row || row.scene !== "person" || row.personKeys.length < 2) {
      console.error(`FAIL group ${file}:`, row);
      ok = false;
    } else {
      console.log(`OK group ${file}: ${row.personKeys.join(",")}`);
    }
  }
  const soloKeys = new Set(
    solos.map((f) => byFile.get(f)?.personKeys[0]).filter(Boolean)
  );
  if (soloKeys.size !== 3) {
    console.error("FAIL: need 3 distinct solo personKeys", [...soloKeys]);
    ok = false;
  }
  const together = albums.find((a) => a.key === "together");
  const personSections = albums.filter((a) => a.key.startsWith("사람"));
  // 각 사람 앨범은 솔로 1장 + 겹치는 함께 사진
  for (const s of personSections) {
    const hasSolo = s.photoIds.some((id) => solos.includes(id));
    if (!hasSolo) {
      console.error(`FAIL ${s.key}: missing solo`, s.photoIds);
      ok = false;
    } else {
      console.log(`OK ${s.label}: ${s.photoIds.join(",")}`);
    }
  }
  if (!together || together.photoIds.length < 1) {
    console.error("FAIL: 함께 should hold group photos", together);
    ok = false;
  } else {
    console.log(`OK 함께: ${together.photoIds.join(",")}`);
  }
  if (!ok) process.exit(2);
  console.log("PASS trio-examples");
  process.exit(0);
}

const persons = rows.filter((r) => r.scene === "person");
const sameFace =
  rows.find((r) => r.file === "p1.jpg")?.personKeys[0] &&
  rows.find((r) => r.file === "p1.jpg")?.personKeys[0] ===
    rows.find((r) => r.file === "p1b.jpg")?.personKeys[0];

console.log("---");
console.log(
  `person_count=${persons.length}/${rows.length} same_face_p1_p1b=${Boolean(sameFace)}`
);
if (persons.length < Math.min(3, rows.length)) {
  console.error("FAIL: expected most samples to be person");
  process.exit(2);
}
if (files.includes("p1.jpg") && files.includes("p1b.jpg") && !sameFace) {
  console.error("FAIL: p1 and p1b should share the same personKey");
  process.exit(3);
}
console.log("PASS");
