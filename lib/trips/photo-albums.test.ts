import { describe, expect, it } from "vitest";
import {
  groupPhotoAlbums,
  normalizePersonKeys,
  type TripPhotoRow,
} from "./photo-albums";

function row(over: Partial<TripPhotoRow> & { id: string }): TripPhotoRow {
  return {
    status: "ready",
    scene: null,
    personKeys: [],
    ...over,
  };
}

describe("normalizePersonKeys", () => {
  it("keeps 사람N only, dedupes, sorts", () => {
    expect(
      normalizePersonKeys(["사람2", "풍경", "사람1", "사람2", "사람10"])
    ).toEqual(["사람1", "사람2", "사람10"]);
  });
});

describe("groupPhotoAlbums", () => {
  it("returns empty for no ready rows", () => {
    expect(
      groupPhotoAlbums([
        row({ id: "a", status: "pending" }),
        row({ id: "b", status: "failed" }),
      ])
    ).toEqual([]);
  });

  it("groups people and scenes", () => {
    const sections = groupPhotoAlbums([
      row({
        id: "p1",
        scene: "person",
        personKeys: ["사람1"],
      }),
      row({
        id: "p2",
        scene: "person",
        personKeys: ["사람1", "사람2"],
      }),
      row({ id: "l1", scene: "landscape", personKeys: [] }),
      row({ id: "f1", scene: "food", personKeys: [] }),
      row({ id: "a1", scene: "animal", personKeys: [] }),
      row({ id: "o1", scene: "other", personKeys: [] }),
    ]);
    // 사람2 는 솔로가 없어 앨범 없음. p2 는 함께 + 확정된 사람1 에만.
    expect(sections.map((s) => s.key)).toEqual([
      "사람1",
      "together",
      "landscape",
      "food",
      "animal",
      "other",
    ]);
    expect(sections[0]!.photoIds).toEqual(["p1", "p2"]);
    expect(sections[1]!).toEqual({
      key: "together",
      label: "함께",
      photoIds: ["p2"],
    });
    expect(sections[2]!.photoIds).toEqual(["l1"]);
    expect(sections[4]!.photoIds).toEqual(["a1"]);
  });

  it("puts unclassified ready into 기타", () => {
    const sections = groupPhotoAlbums([
      row({ id: "x", scene: null, personKeys: [] }),
    ]);
    expect(sections).toEqual([
      { key: "other", label: "기타", photoIds: ["x"] },
    ]);
  });

  /**
   * 3명 여행 예시:
   * - solo → 사람N (확정)
   * - duo/trio → 함께 + 겹치는 확정 사람N 에도 통째로
   */
  it("puts overlapping together photos into established person albums", () => {
    const sections = groupPhotoAlbums([
      row({ id: "solo_a", scene: "person", personKeys: ["사람1"] }),
      row({ id: "solo_b", scene: "person", personKeys: ["사람2"] }),
      row({ id: "solo_c", scene: "person", personKeys: ["사람3"] }),
      row({
        id: "duo_ab",
        scene: "person",
        personKeys: ["사람1", "사람2"],
      }),
      row({
        id: "duo_ac",
        scene: "person",
        personKeys: ["사람1", "사람3"],
      }),
      row({
        id: "trio_abc",
        scene: "person",
        personKeys: ["사람1", "사람2", "사람3"],
      }),
      // 솔로 없는 사람4 만 있는 단체 → 함께만
      row({
        id: "duo_strangers",
        scene: "person",
        personKeys: ["사람4", "사람5"],
      }),
    ]);

    expect(sections.map((s) => ({ key: s.key, ids: s.photoIds }))).toEqual([
      {
        key: "사람1",
        ids: ["solo_a", "duo_ab", "duo_ac", "trio_abc"],
      },
      {
        key: "사람2",
        ids: ["solo_b", "duo_ab", "trio_abc"],
      },
      {
        key: "사람3",
        ids: ["solo_c", "duo_ac", "trio_abc"],
      },
      {
        key: "together",
        ids: ["duo_ab", "duo_ac", "trio_abc", "duo_strangers"],
      },
    ]);
  });
});
