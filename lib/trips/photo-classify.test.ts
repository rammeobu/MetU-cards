import { describe, expect, it } from "vitest";
import { applyClassifyItem } from "./photo-classify";

describe("applyClassifyItem", () => {
  it("forces person scene when personKeys present", () => {
    expect(
      applyClassifyItem({
        index: 0,
        scene: "landscape",
        personKeys: ["사람1"],
      })
    ).toEqual({ scene: "person", personKeys: ["사람1"] });
  });

  it("downgrades empty person to other", () => {
    expect(
      applyClassifyItem({ index: 0, scene: "person", personKeys: [] })
    ).toEqual({ scene: "other", personKeys: [] });
  });

  it("keeps animal without personKeys", () => {
    expect(
      applyClassifyItem({ index: 0, scene: "animal", personKeys: [] })
    ).toEqual({ scene: "animal", personKeys: [] });
  });
});
