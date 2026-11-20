import { emptySnapshot } from "@/lib/steps/earn";
import type { StepsSnapshot } from "@/lib/steps/types";

export const STEPS_STORAGE_KEY = "metu.steps.v1";

function isDay(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.dayKey === "string" &&
    typeof d.steps === "number" &&
    typeof d.pointsEarnedToday === "number"
  );
}

export function parseSnapshot(raw: unknown): StepsSnapshot {
  if (!raw || typeof raw !== "object") return emptySnapshot();
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || typeof o.lifetimePoints !== "number") {
    return emptySnapshot();
  }
  const daysIn = o.days;
  if (!daysIn || typeof daysIn !== "object") return emptySnapshot();
  const days: StepsSnapshot["days"] = {};
  for (const [k, v] of Object.entries(daysIn as Record<string, unknown>)) {
    if (isDay(v)) {
      const d = v as StepsSnapshot["days"][string];
      days[k] = {
        dayKey: d.dayKey,
        steps: Math.max(0, Math.floor(d.steps)),
        pointsEarnedToday: Math.max(0, Math.floor(d.pointsEarnedToday)),
      };
    }
  }
  return {
    version: 1,
    days,
    lifetimePoints: Math.max(0, Math.floor(o.lifetimePoints)),
  };
}

export function loadStepsSnapshot(): StepsSnapshot {
  if (typeof window === "undefined") return emptySnapshot();
  try {
    const raw = window.localStorage.getItem(STEPS_STORAGE_KEY);
    if (!raw) return emptySnapshot();
    return parseSnapshot(JSON.parse(raw) as unknown);
  } catch {
    return emptySnapshot();
  }
}

export function saveStepsSnapshot(snap: StepsSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STEPS_STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* quota / private mode */
  }
}
