import { describe, expect, it } from "vitest";
import {
  DAILY_POINT_CAP,
  STEPS_PER_POINT,
  applyDeltaToSnapshot,
  applyStepsDelta,
  dayKeyKst,
  emptyDay,
  emptySnapshot,
  pointsFromSteps,
  resetTodayInSnapshot,
} from "./earn";

describe("pointsFromSteps", () => {
  it("1000걸음당 1포인트", () => {
    expect(pointsFromSteps(0)).toBe(0);
    expect(pointsFromSteps(999)).toBe(0);
    expect(pointsFromSteps(1000)).toBe(1);
    expect(pointsFromSteps(2500)).toBe(2);
  });
});

describe("applyStepsDelta", () => {
  it("워터마크 — 이미 적립한 구간은 다시 안 줘요", () => {
    const day = emptyDay("2026-11-20");
    const first = applyStepsDelta(day, 2000, 0);
    expect(first.newlyEarned).toBe(2);
    expect(first.day.pointsEarnedToday).toBe(2);

    const second = applyStepsDelta(first.day, 500, first.lifetimePoints);
    expect(second.newlyEarned).toBe(0);
    expect(second.day.steps).toBe(2500);
    expect(second.day.pointsEarnedToday).toBe(2);

    const third = applyStepsDelta(second.day, 500, second.lifetimePoints);
    expect(third.newlyEarned).toBe(1);
    expect(third.day.pointsEarnedToday).toBe(3);
  });

  it("하루 상한을 지켜요", () => {
    const day = emptyDay("2026-11-20");
    const r = applyStepsDelta(day, DAILY_POINT_CAP * STEPS_PER_POINT + 5000, 0);
    expect(r.newlyEarned).toBe(DAILY_POINT_CAP);
    expect(r.day.pointsEarnedToday).toBe(DAILY_POINT_CAP);

    const more = applyStepsDelta(r.day, 10_000, r.lifetimePoints);
    expect(more.newlyEarned).toBe(0);
  });
});

describe("snapshot helpers", () => {
  it("dayKeyKst 는 YYYY-MM-DD", () => {
    expect(dayKeyKst(new Date("2026-11-20T12:00:00+09:00"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
  });

  it("resetToday 는 누적 포인트를 유지해요", () => {
    let snap = emptySnapshot();
    const applied = applyDeltaToSnapshot(snap, "2026-11-20", 3000);
    snap = applied.snapshot;
    expect(snap.lifetimePoints).toBe(3);
    snap = resetTodayInSnapshot(snap, "2026-11-20");
    expect(snap.days["2026-11-20"]?.steps).toBe(0);
    expect(snap.days["2026-11-20"]?.pointsEarnedToday).toBe(0);
    expect(snap.lifetimePoints).toBe(3);
  });
});
