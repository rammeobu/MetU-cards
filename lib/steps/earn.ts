import type { DayStepsState, StepsSnapshot } from "@/lib/steps/types";

/** 1000걸음 = 1포인트 */
export const STEPS_PER_POINT = 1000;
/** 하루 적립 상한 (2만 걸음 상당) */
export const DAILY_POINT_CAP = 20;

/** Asia/Seoul 기준 YYYY-MM-DD */
export function dayKeyKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 걸음수 → 이론상 포인트 (상한 미적용). */
export function pointsFromSteps(steps: number): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0;
  return Math.floor(steps / STEPS_PER_POINT);
}

export function emptyDay(dayKey: string): DayStepsState {
  return { dayKey, steps: 0, pointsEarnedToday: 0 };
}

export function emptySnapshot(): StepsSnapshot {
  return { version: 1, days: {}, lifetimePoints: 0 };
}

/**
 * 오늘 상태에 걸음 델타를 반영하고, 새로 적립된 포인트를 돌려줘요.
 * 이미 적립한 구간은 다시 주지 않으며 하루 상한을 지켜요.
 */
export function applyStepsDelta(
  day: DayStepsState,
  deltaSteps: number,
  lifetimePoints: number
): { day: DayStepsState; lifetimePoints: number; newlyEarned: number } {
  const delta =
    Number.isFinite(deltaSteps) && deltaSteps !== 0
      ? Math.trunc(deltaSteps)
      : 0;
  const nextSteps = Math.max(0, day.steps + delta);
  const maxPossible = Math.min(DAILY_POINT_CAP, pointsFromSteps(nextSteps));
  const newlyEarned = Math.max(0, maxPossible - day.pointsEarnedToday);
  return {
    day: {
      dayKey: day.dayKey,
      steps: nextSteps,
      pointsEarnedToday: day.pointsEarnedToday + newlyEarned,
    },
    lifetimePoints: lifetimePoints + newlyEarned,
    newlyEarned,
  };
}

/** 스냅샷에서 오늘(dayKey) 상태를 가져와요. 없으면 빈 날. */
export function dayFromSnapshot(
  snap: StepsSnapshot,
  dayKey: string
): DayStepsState {
  return snap.days[dayKey] ?? emptyDay(dayKey);
}

/** 오늘에 델타를 적용한 새 스냅샷. */
export function applyDeltaToSnapshot(
  snap: StepsSnapshot,
  dayKey: string,
  deltaSteps: number
): { snapshot: StepsSnapshot; newlyEarned: number } {
  const current = dayFromSnapshot(snap, dayKey);
  const { day, lifetimePoints, newlyEarned } = applyStepsDelta(
    current,
    deltaSteps,
    snap.lifetimePoints
  );
  return {
    snapshot: {
      version: 1,
      days: { ...snap.days, [dayKey]: day },
      lifetimePoints,
    },
    newlyEarned,
  };
}

/** 오늘 걸음·적립만 초기화 (누적 포인트는 유지). */
export function resetTodayInSnapshot(
  snap: StepsSnapshot,
  dayKey: string
): StepsSnapshot {
  return {
    version: 1,
    days: { ...snap.days, [dayKey]: emptyDay(dayKey) },
    lifetimePoints: snap.lifetimePoints,
  };
}
