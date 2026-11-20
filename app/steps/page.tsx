"use client";

import { MobileShell } from "@/components/layout/MobileShell";
import { StepsPointsPanel } from "@/components/steps/StepsPointsPanel";

export default function StepsPage() {
  return (
    <MobileShell title="만보기 포인트" showBack backHref="/profile">
      <div className="mx-auto flex w-full max-w-mobile flex-col gap-4 px-4 py-4">
        <p className="text-mu-body text-mu-fg-2">
          걸음으로 포인트를 모아요. 지금은 기기 안에만 저장되는 프로토타입이에요.
        </p>
        <StepsPointsPanel />
      </div>
    </MobileShell>
  );
}
