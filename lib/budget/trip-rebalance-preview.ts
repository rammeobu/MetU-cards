import {
  rebalanceScheduleBudget,
  type RebalanceResult,
} from "@/lib/budget/rebalancer";
import {
  applyRebalanceCostsToSchedule,
  scheduleToRebalanceItems,
} from "@/lib/budget/schedule-map";
import type { TripDaySchedule } from "@/lib/trips/types";

export type ScheduleRebalancePreview = {
  /** max(0, budget − spent) */
  targetKrw: number;
  result: RebalanceResult;
  nextSchedule: TripDaySchedule[];
  /** savedAmount > 0 이면 시트에서 확인 후 저장 */
  needsApply: boolean;
};

/**
 * 남은 한도(예산−실제지출)에 맞춰 일정 예상비용을 줄인 미리보기.
 * 금액은 정수 KRW. LLM/클라이언트 임의 계산 금지 — 이 순수 함수만 씀.
 */
export function buildScheduleRebalancePreview(args: {
  budget: number;
  spent: number;
  schedule: TripDaySchedule[];
}): ScheduleRebalancePreview {
  const targetKrw = Math.max(
    0,
    Math.trunc(args.budget) - Math.trunc(args.spent)
  );
  const items = scheduleToRebalanceItems(args.schedule);
  const result = rebalanceScheduleBudget(items, targetKrw);
  const nextSchedule = applyRebalanceCostsToSchedule(
    args.schedule,
    result.adjustedItems
  );
  return {
    targetKrw,
    result,
    nextSchedule,
    needsApply: result.savedAmount > 0,
  };
}
