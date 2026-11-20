import {
  classifyRebalanceCategory,
  type RebalanceItem,
} from "@/lib/budget/rebalancer";

/** DaySchedule / TripDaySchedule 공통 — kind 없으면 제목 휴리스틱만 씀 */
export type ScheduleItemForRebalance = {
  title: string;
  cost: number;
  kind?: string;
};

export type ScheduleDayForRebalance<
  T extends ScheduleItemForRebalance = ScheduleItemForRebalance,
> = {
  day: number;
  label: string;
  dayTotal: number;
  items: T[];
};

export function scheduleToRebalanceItems(
  schedule: ReadonlyArray<ScheduleDayForRebalance>
): RebalanceItem[] {
  const items: RebalanceItem[] = [];
  for (const day of schedule) {
    for (let i = 0; i < day.items.length; i += 1) {
      const item = day.items[i]!;
      items.push({
        id: `d${day.day}-${i}-${item.title}`,
        name: `Day ${day.day} ${item.title}`,
        category: classifyRebalanceCategory(item.kind, item.title),
        costKRW: Math.max(0, Math.floor(item.cost)),
        isFixed: item.kind === "attraction" || item.kind === "lodging",
      });
    }
  }
  return items;
}

export function applyRebalanceCostsToSchedule<
  T extends ScheduleItemForRebalance,
  D extends ScheduleDayForRebalance<T>,
>(schedule: ReadonlyArray<D>, adjusted: RebalanceItem[]): D[] {
  const costById = new Map(adjusted.map((a) => [a.id, a.costKRW]));
  return schedule.map((day) => {
    const items = day.items.map((item, i) => {
      const id = `d${day.day}-${i}-${item.title}`;
      const next = costById.get(id);
      return next == null ? item : { ...item, cost: next };
    });
    return {
      ...day,
      items,
      dayTotal: items.reduce((s, it) => s + it.cost, 0),
    };
  });
}

/** 슬라이더 미리보기: 현재 일정 합 − 목표 현지 가용 */
export function previewDiscretionaryGap(params: {
  schedule: ReadonlyArray<ScheduleDayForRebalance>;
  targetDiscretionaryBudget: number;
}): { scheduleTotal: number; gap: number } {
  const scheduleTotal = params.schedule.reduce(
    (sum, day) =>
      sum +
      day.items.reduce((s, it) => s + Math.max(0, Math.floor(it.cost)), 0),
    0
  );
  const target = Math.max(0, Math.floor(params.targetDiscretionaryBudget));
  return { scheduleTotal, gap: scheduleTotal - target };
}
