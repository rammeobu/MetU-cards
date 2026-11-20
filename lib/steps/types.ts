/** 하루 만보기·포인트 상태 (프로토타입). */
export type DayStepsState = {
  /** KST YYYY-MM-DD */
  dayKey: string;
  steps: number;
  /** 오늘 이미 적립한 포인트 */
  pointsEarnedToday: number;
};

/** localStorage 스냅샷. */
export type StepsSnapshot = {
  version: 1;
  days: Record<string, DayStepsState>;
  lifetimePoints: number;
};

export type SensorSubscribeResult =
  | { ok: true; stop: () => void }
  | { ok: false; reason: "unsupported" | "denied" | "error" };
