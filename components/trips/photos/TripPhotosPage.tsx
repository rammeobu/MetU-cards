"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ImagePlus, Loader2 } from "lucide-react";
import { BottomCTA, ScreenHeader, Skeleton } from "@/components/ds";
import {
  groupPhotoAlbums,
  type TripPhotoRow,
} from "@/lib/trips/photo-albums";

type ApiPhoto = {
  id: string;
  status: "pending" | "ready" | "failed";
  scene: TripPhotoRow["scene"];
  personKeys: string[];
  error: string | null;
  createdAt: string;
  url: string | null;
};

interface Props {
  tripId: string;
}

export function TripPhotosPage({ tripId }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<ApiPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/trips/${tripId}/photos`, {
        credentials: "same-origin",
      });
      if (res.status === 401 || res.status === 403) {
        setError("사진을 보려면 로그인이 필요해요.");
        setPhotos([]);
        return;
      }
      if (!res.ok) {
        setError("사진 목록을 불러오지 못했어요.");
        return;
      }
      const json = (await res.json()) as { photos: ApiPhoto[] };
      setPhotos(json.photos ?? []);
    } catch {
      setError("네트워크 오류로 사진을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const albums = useMemo(() => {
    const rows: TripPhotoRow[] = photos.map((p) => ({
      id: p.id,
      status: p.status,
      scene: p.scene,
      personKeys: p.personKeys,
      url: p.url,
      error: p.error,
    }));
    return groupPhotoAlbums(rows);
  }, [photos]);

  const pendingCount = photos.filter(
    (p) => p.status === "pending" || p.status === "failed"
  ).length;
  const otherReadyCount = photos.filter(
    (p) => p.status === "ready" && p.scene === "other"
  ).length;
  const classifyCount = pendingCount + otherReadyCount;
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0 || uploading) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files).slice(0, 12)) {
        const form = new FormData();
        form.set("file", file);
        const res = await fetch(`/api/trips/${tripId}/photos`, {
          method: "POST",
          credentials: "same-origin",
          body: form,
        });
        if (res.status === 401 || res.status === 403) {
          setError("사진을 올리려면 로그인이 필요해요.");
          break;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(
            body?.error === "payload-too-large"
              ? "파일이 너무 커요. 8MB 이하로 올려 주세요."
              : "사진 업로드에 실패했어요."
          );
          break;
        }
      }
      await load();
    } catch {
      setError("업로드 중 네트워크 오류가 났어요.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onClassify = async () => {
    if (classifying || classifyCount === 0) return;
    setClassifying(true);
    setError("");
    try {
      const res = await fetch(`/api/trips/${tripId}/photos/classify`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeOther: otherReadyCount > 0 }),
      });
      const body = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
      } | null;
      if (!res.ok || body?.error) {
        setError(
          body?.message ??
            "사진 분류에 실패했어요. 잠시 후 다시 시도해 주세요."
        );
      }
      await load();
    } catch {
      setError("분류 중 네트워크 오류가 났어요.");
    } finally {
      setClassifying(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-mu-bg">
      <ScreenHeader
        title="여행 사진"
        left={
          <button
            type="button"
            onClick={() => router.push(`/trips/${tripId}`)}
            aria-label="뒤로"
            className="mu-focus flex h-11 w-11 items-center justify-center rounded-mu-md text-mu-fg"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-2">
        <div className="flex flex-col gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(e) => void onPick(e.target.files)}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-mu-line bg-mu-card px-4 text-sm font-bold text-mu-fg"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="h-4 w-4" aria-hidden />
            )}
            {uploading ? "올리는 중…" : "사진 추가하기"}
          </button>

          {error ? (
            <p role="alert" className="text-center text-mu-caption text-mu-err">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-xl" />
              ))}
            </div>
          ) : null}

          {!loading && photos.length === 0 ? (
            <p className="py-10 text-center text-mu-body text-mu-fg-3">
              아직 올린 사진이 없어요.
            </p>
          ) : null}

          {!loading && albums.length > 0
            ? albums.map((section) => (
                <section key={section.key} className="flex flex-col gap-2">
                  <h2 className="text-sm font-extrabold text-mu-fg">
                    {section.label}
                  </h2>
                  <ul className="grid grid-cols-3 gap-2">
                    {section.photoIds.map((id) => {
                      const photo = byId.get(id);
                      return (
                        <li
                          key={`${section.key}-${id}`}
                          className="relative aspect-square overflow-hidden rounded-xl border border-mu-line bg-mu-card"
                        >
                          {photo?.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={photo.url}
                              alt=""
                              className="h-full w-full object-contain bg-mu-bg"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-mu-caption text-mu-fg-3">
                              …
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            : null}

          {!loading && classifyCount > 0 ? (
            <p className="text-mu-caption text-mu-fg-2">
              {pendingCount > 0
                ? `분류 대기 ${pendingCount}장`
                : `기타 ${otherReadyCount}장 다시 분류`}
              {" · "}한 번에 최대 8장까지 분류해요.
            </p>
          ) : null}

          {!loading &&
          photos.some((p) => p.status === "failed") ? (
            <ul className="flex flex-col gap-1">
              {photos
                .filter((p) => p.status === "failed")
                .map((p) => (
                  <li key={p.id} className="text-mu-caption text-mu-err">
                    {p.error ?? "분류에 실패했어요"}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      </div>

      {classifyCount > 0 ? (
        <BottomCTA
          label={
            classifying
              ? "분류 중…"
              : pendingCount > 0
                ? "분류하기"
                : "기타 다시 분류하기"
          }
          onClick={() => void onClassify()}
          loading={classifying}
          disabled={classifying || uploading}
        />
      ) : null}
    </div>
  );
}
