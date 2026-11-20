/**
 * window 가 아니라 overflow 스크롤 부모(예: MobileShell main) 안에서
 * 대상이 보이도록 scrollTop 을 맞춘다.
 */
export function scrollIntoScrollParent(
  el: HTMLElement,
  opts?: { offsetPx?: number; behavior?: ScrollBehavior }
): void {
  const offsetPx = opts?.offsetPx ?? 8;
  const behavior = opts?.behavior ?? "smooth";

  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    const oy = style.overflowY;
    const scrollable =
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      parent.scrollHeight > parent.clientHeight + 1;
    if (scrollable) break;
    parent = parent.parentElement;
  }

  const scroller: HTMLElement | Document = parent ?? document.documentElement;
  if (scroller instanceof Document) {
    el.scrollIntoView({ behavior, block: "start" });
    return;
  }

  const elRect = el.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const nextTop =
    scroller.scrollTop + (elRect.top - scrollerRect.top) - offsetPx;
  scroller.scrollTo({ top: Math.max(0, nextTop), behavior });
}
