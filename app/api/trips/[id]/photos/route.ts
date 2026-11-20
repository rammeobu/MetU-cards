import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { detectImageMime } from "@/lib/agent/image-magic";
import { TABLES } from "@/lib/constants";
import { MULTIPART_OVERHEAD_BYTES } from "@/lib/ledger/image-limits";
import { guardApi, rejectAnonymousWrite } from "@/lib/security/guard";
import {
  TRIP_PHOTO_BUCKET,
  TRIP_PHOTO_MAX_BYTES,
} from "@/lib/trips/photo-classify";
import { requireTripPhotoAccess } from "@/lib/trips/photo-server";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

type PhotoRow = {
  id: string;
  trip_id: string;
  uploaded_by: string;
  storage_path: string;
  status: "pending" | "ready" | "failed";
  scene: "person" | "landscape" | "food" | "animal" | "other" | null;
  person_keys: string[] | null;
  error: string | null;
  created_at: string;
};

/** 멤버: 사진 목록 + signed URL */
export async function GET(request: Request, ctx: Ctx) {
  const guard = await guardApi(request, { bucket: "ledger-parse" });
  if (guard instanceof NextResponse) return guard;
  if (guard.identity.kind !== "user") {
    return NextResponse.json({ error: "login-required" }, { status: 401 });
  }

  const { id: tripId } = await ctx.params;
  const gate = await requireTripPhotoAccess(tripId, guard.identity.userId);
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase
    .from(TABLES.tripPhotos)
    .select(
      "id, trip_id, uploaded_by, storage_path, status, scene, person_keys, error, created_at"
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[api/trips/photos] list", error.message);
    return NextResponse.json({ error: "list-failed" }, { status: 500 });
  }

  const rows = (data ?? []) as PhotoRow[];
  const photos = await Promise.all(
    rows.map(async (row) => {
      let url: string | null = null;
      const { data: signed } = await gate.supabase.storage
        .from(TRIP_PHOTO_BUCKET)
        .createSignedUrl(row.storage_path, 3600);
      url = signed?.signedUrl ?? null;
      return {
        id: row.id,
        status: row.status,
        scene: row.scene,
        personKeys: row.person_keys ?? [],
        error: row.error,
        createdAt: row.created_at,
        url,
      };
    })
  );

  return NextResponse.json({ photos });
}

/** 멤버(비익명): 이미지 업로드 → pending row */
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

  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (
    Number.isFinite(declared) &&
    declared > TRIP_PHOTO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES
  ) {
    return NextResponse.json({ error: "payload-too-large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid-form" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file-required" }, { status: 400 });
  }
  if (file.size > TRIP_PHOTO_MAX_BYTES) {
    return NextResponse.json({ error: "payload-too-large" }, { status: 413 });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const mime = detectImageMime(buf);
  if (!mime) {
    return NextResponse.json({ error: "unsupported-image" }, { status: 400 });
  }

  const ext =
    mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = `${tripId}/${guard.identity.userId}/${randomUUID()}.${ext}`;

  const { error: upErr } = await gate.supabase.storage
    .from(TRIP_PHOTO_BUCKET)
    .upload(path, buf, { contentType: mime, upsert: false });
  if (upErr) {
    console.error("[api/trips/photos] upload", upErr.message);
    return NextResponse.json({ error: "upload-failed" }, { status: 500 });
  }

  const { data: inserted, error: insErr } = await gate.supabase
    .from(TABLES.tripPhotos)
    .insert({
      trip_id: tripId,
      uploaded_by: guard.identity.userId,
      storage_path: path,
      status: "pending",
    })
    .select(
      "id, trip_id, uploaded_by, storage_path, status, scene, person_keys, error, created_at"
    )
    .single();

  if (insErr || !inserted) {
    console.error("[api/trips/photos] insert", insErr?.message);
    await gate.supabase.storage.from(TRIP_PHOTO_BUCKET).remove([path]);
    return NextResponse.json({ error: "insert-failed" }, { status: 500 });
  }

  const row = inserted as PhotoRow;
  return NextResponse.json(
    {
      photo: {
        id: row.id,
        status: row.status,
        scene: row.scene,
        personKeys: row.person_keys ?? [],
        error: row.error,
        createdAt: row.created_at,
        url: null,
      },
    },
    { status: 201 }
  );
}
