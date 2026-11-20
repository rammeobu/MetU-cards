import { describe, expect, it } from "vitest";

import {
  budgetNeedsScheduleReview,
  budgetOverageCopy,
  deriveBudgetView,
  planEstimateKrw,
} from "@/lib/ledger/plan-estimate";

describe("planEstimateKrw", () => {
  it("일정 dayTotal 합을 우선해요", () => {
    expect(
      planEstimateKrw({
        dailySchedule: [
          { day: 1, label: "D1", items: [], dayTotal: 100_000 },
          { day: 2, label: "D2", items: [], dayTotal: 50_000 },
        ],
        budgetAllocation: [{ id: "a", label: "식비", amount: 999, percent: 1, color: "#" }],
      })
    ).toBe(150_000);
  });

  it("일정이 없으면 배분 합을 써요", () => {
    expect(
      planEstimateKrw({
        budgetAllocation: [
          { id: "a", label: "숙소", amount: 200_000, percent: 50, color: "#" },
          { id: "b", label: "식비", amount: 100_000, percent: 50, color: "#" },
        ],
      })
    ).toBe(300_000);
  });
});

describe("deriveBudgetView / overage", () => {
  it("한도 초과 + 일정이 남은 한도보다 크면 일정 확인 CTA", () => {
    const v = deriveBudgetView({ budget: 100, spent: 150, planKrw: 80 });
    expect(v.overLimit).toBe(true);
    expect(v.planExceedsRemaining).toBe(true);
    expect(budgetNeedsScheduleReview(v)).toBe(true);
    expect(budgetOverageCopy(v)).toContain("확인이 필요해요");
  });

  it("남은 한도보다 일정이 크면 일정 확인 CTA", () => {
    // remaining 50, plan 100
    const v = deriveBudgetView({ budget: 200, spent: 150, planKrw: 100 });
    expect(v.overLimit).toBe(false);
    expect(v.planExceedsRemaining).toBe(true);
    expect(budgetNeedsScheduleReview(v)).toBe(true);
    expect(budgetOverageCopy(v)).toContain("남은 한도");
  });

  it("리밸런스 후 일정이 남은 한도에 맞으면 배너·CTA 없음", () => {
    // remaining 50, plan 50
    const v = deriveBudgetView({ budget: 200, spent: 150, planKrw: 50 });
    expect(v.planExceedsRemaining).toBe(false);
    expect(budgetNeedsScheduleReview(v)).toBe(false);
    expect(v.overPlan).toBe(true);
    expect(budgetOverageCopy(v)).toBeNull();
  });

  it("한도만 초과하고 일정은 이미 0이면 CTA 없음", () => {
    const v = deriveBudgetView({ budget: 100, spent: 150, planKrw: 0 });
    // planKrw 0 → planEstimate returns null for 0? We pass 0 explicitly
    // planExceedsRemaining: planKrw != null && 0 > max(0, -50) → 0 > 0 → false
    expect(v.planExceedsRemaining).toBe(false);
    expect(budgetNeedsScheduleReview(v)).toBe(false);
    expect(budgetOverageCopy(v)).toContain("일정 예상은 남은 한도에 맞춰");
  });
});
