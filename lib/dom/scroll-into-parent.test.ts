// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollIntoScrollParent } from "@/lib/dom/scroll-into-parent";

describe("scrollIntoScrollParent", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("overflow 부모의 scrollTo를 호출해요", () => {
    const scroller = document.createElement("div");
    Object.defineProperty(scroller, "scrollHeight", { value: 800 });
    Object.defineProperty(scroller, "clientHeight", { value: 200 });
    scroller.style.overflowY = "auto";
    scroller.scrollTop = 0;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;

    const child = document.createElement("div");
    scroller.appendChild(child);
    document.body.appendChild(scroller);

    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({
      top: 300,
      bottom: 400,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 300,
      toJSON: () => ({}),
    });
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 200,
      left: 0,
      right: 100,
      width: 100,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    scrollIntoScrollParent(child, { offsetPx: 10, behavior: "auto" });

    expect(scrollTo).toHaveBeenCalled();
    const arg = scrollTo.mock.calls[0]?.[0] as ScrollToOptions;
    expect(arg.top).toBe(290);
  });
});
