"use client";

import { Sheet } from "@/components/ds/Sheet";
import type { ScheduleRebalancePreview } from "@/lib/budget/trip-rebalance-preview";
import { formatKRW } from "@/lib/shared/format";

type Props = {
  open: boolean;
  preview: ScheduleRebalancePreview | null;
  onClose: () => void;
  onApply: () => void;
};

export function ScheduleRebalancePreviewSheet({
  open,
  preview,
  onClose,
  onApply,
}: Props) {
  if (!preview) return null;

  const logLines = preview.result.adjustmentsLog
    .filter((l) => l.includes("-₩"))
    .slice(0, 3);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="일정 예산 맞추기"
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onApply}
            className="mu-focus min-h-[52px] w-full rounded-xl bg-mu-accent py-3 text-sm font-extrabold text-mu-on-accent"
          >
            일정에 반영하기
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mu-focus min-h-tap w-full rounded-xl border border-mu-line py-3 text-sm font-bold text-mu-fg-2"
          >
            닫기
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-mu-body leading-relaxed text-mu-fg-2">
          남은 한도{" "}
          <span className="mu-num font-bold text-mu-fg">
            {formatKRW(preview.targetKrw)}
          </span>
          에 맞춰 일정 예상 비용을 줄여 드려요.
        </p>
        <dl className="grid grid-cols-2 gap-2 text-mu-caption">
          <div className="rounded-mu-md bg-mu-sunken px-3 py-2">
            <dt className="font-medium text-mu-fg-3">현재 일정 합</dt>
            <dd className="mu-num mt-0.5 font-bold text-mu-fg">
              {formatKRW(preview.result.originalTotal)}
            </dd>
          </div>
          <div className="rounded-mu-md bg-mu-sunken px-3 py-2">
            <dt className="font-medium text-mu-fg-3">조정 후</dt>
            <dd className="mu-num mt-0.5 font-bold text-mu-fg">
              {formatKRW(preview.result.newTotal)}
            </dd>
          </div>
          <div className="col-span-2 rounded-mu-md border border-mu-ok/20 bg-mu-ok-soft px-3 py-2">
            <dt className="font-medium text-mu-fg-3">절감</dt>
            <dd className="mu-num mt-0.5 font-extrabold text-mu-ok">
              {formatKRW(preview.result.savedAmount)}
            </dd>
          </div>
        </dl>
        {logLines.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-mu-caption leading-snug text-mu-fg-2">
            {logLines.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Sheet>
  );
}
