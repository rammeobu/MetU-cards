import { describe, expect, it } from "vitest";
import { buildScheduleRebalancePreview } from "@/lib/budget/trip-rebalance-preview";
import type { TripDaySchedule } from "@/lib/trips/types";

const schedule: TripDaySchedule[] = [
  {
    day: 1,
    label: "Day 1",
    dayTotal: 100_000,
    items: [
      { time: "12:00", title: "라멘 점심", cost: 50_000 },
      { time: "15:00", title: "카페", cost: 20_000 },
      { time: "18:00", title: "액티비티 투어", cost: 30_000 },
    ],
  },
];

describe("buildScheduleRebalancePreview", () => {
  it("남은 한도(budget−spent)를 target으로 써요", () => {
    const preview = buildScheduleRebalancePreview({
      budget: 200_000,
      spent: 150_000,
      schedule,
    });
    expect(preview.targetKrw).toBe(50_000);
    expect(preview.needsApply).toBe(true);
    expect(preview.result.newTotal).toBeLessThanOrEqual(50_000);
    expect(
      preview.nextSchedule.reduce((s, d) => s + d.dayTotal, 0)
    ).toBe(preview.result.newTotal);
  });

  it("이미 한도 안이면 적용 불필요예요", () => {
    const preview = buildScheduleRebalancePreview({
      budget: 500_000,
      spent: 0,
      schedule,
    });
    expect(preview.targetKrw).toBe(500_000);
    expect(preview.needsApply).toBe(false);
    expect(preview.result.savedAmount).toBe(0);
  });

  it("초과 지출이면 target은 0이에요", () => {
    const preview = buildScheduleRebalancePreview({
      budget: 100_000,
      spent: 120_000,
      schedule,
    });
    expect(preview.targetKrw).toBe(0);
    expect(preview.needsApply).toBe(true);
  });
});
