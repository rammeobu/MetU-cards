/** 여행 사진 → 앨범 섹션 그룹핑 (순수). */

export type PhotoScene =
  | "person"
  | "landscape"
  | "food"
  | "animal"
  | "other";

const NON_PERSON_SCENES = [
  "landscape",
  "food",
  "animal",
  "other",
] as const satisfies ReadonlyArray<Exclude<PhotoScene, "person">>;

export type TripPhotoRow = {
  id: string;
  status: "pending" | "ready" | "failed";
  scene: PhotoScene | null;
  personKeys: string[];
  url?: string | null;
  error?: string | null;
};

export type PhotoAlbumSection = {
  key: string;
  label: string;
  photoIds: string[];
};

const PERSON_KEY = /^사람([1-9]\d?)$/;

const SCENE_LABEL: Record<Exclude<PhotoScene, "person">, string> = {
  landscape: "풍경",
  food: "음식",
  animal: "동물",
  other: "기타",
};

/** personKeys 정규화: 사람1…사람99 만, 중복 제거·정렬 */
export function normalizePersonKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keys) {
    const m = PERSON_KEY.exec(raw.trim());
    if (!m) continue;
    const key = `사람${m[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.sort((a, b) => {
    const na = Number(PERSON_KEY.exec(a)?.[1] ?? 0);
    const nb = Number(PERSON_KEY.exec(b)?.[1] ?? 0);
    return na - nb;
  });
}

function pushUnique(map: Map<string, string[]>, key: string, id: string): void {
  const list = map.get(key) ?? [];
  if (!list.includes(id)) list.push(id);
  map.set(key, list);
}

/**
 * ready 사진만 앨범으로 묶어요.
 * - 사람N: 솔로(그 사람만) + 함께 사진 중 이미 솔로로 확정된 사람N 과 겹치는 장
 *   (사진은 쪼개지 않고 통째로 넣음)
 * - 함께: 두 명 이상인 사진 전부
 * - 풍경/음식/동물/기타: scene 기준
 */
export function groupPhotoAlbums(rows: TripPhotoRow[]): PhotoAlbumSection[] {
  const ready = rows.filter((r) => r.status === "ready");
  const byPerson = new Map<string, string[]>();
  const togetherIds: string[] = [];
  const byScene = new Map<Exclude<PhotoScene, "person">, string[]>();

  // 솔로로 한 번이라도 나온 사람만 "앞에 확정된 사람1…N"
  const established = new Set<string>();
  for (const row of ready) {
    const keys = normalizePersonKeys(row.personKeys);
    if (keys.length === 1) established.add(keys[0]!);
  }

  for (const row of ready) {
    const keys = normalizePersonKeys(row.personKeys);

    if (keys.length === 1) {
      pushUnique(byPerson, keys[0]!, row.id);
    } else if (keys.length >= 2) {
      if (!togetherIds.includes(row.id)) togetherIds.push(row.id);
      for (const key of keys) {
        if (established.has(key)) pushUnique(byPerson, key, row.id);
      }
    }

    const scene = row.scene;
    if (
      scene === "landscape" ||
      scene === "food" ||
      scene === "animal" ||
      scene === "other"
    ) {
      const list = byScene.get(scene) ?? [];
      if (!list.includes(row.id)) list.push(row.id);
      byScene.set(scene, list);
    } else if (scene === "person" || keys.length > 0) {
      // 사람/함께 섹션에만 포함
    } else if (scene == null && keys.length === 0) {
      const list = byScene.get("other") ?? [];
      if (!list.includes(row.id)) list.push(row.id);
      byScene.set("other", list);
    }
  }

  const sections: PhotoAlbumSection[] = [];

  const personKeys = [...byPerson.keys()].sort((a, b) => {
    const na = Number(PERSON_KEY.exec(a)?.[1] ?? 0);
    const nb = Number(PERSON_KEY.exec(b)?.[1] ?? 0);
    return na - nb;
  });
  for (const key of personKeys) {
    const ids = byPerson.get(key) ?? [];
    if (ids.length === 0) continue;
    sections.push({ key, label: key, photoIds: ids });
  }

  if (togetherIds.length > 0) {
    sections.push({
      key: "together",
      label: "함께",
      photoIds: togetherIds,
    });
  }

  for (const scene of NON_PERSON_SCENES) {
    const ids = byScene.get(scene) ?? [];
    if (ids.length === 0) continue;
    sections.push({
      key: scene,
      label: SCENE_LABEL[scene],
      photoIds: ids,
    });
  }

  return sections;
}
