"use client";

import { useCallback, useEffect, useState } from "react";
import { Footprints, RotateCcw } from "lucide-react";
import { Button } from "@/components/ds/Button";
import {
  DAILY_POINT_CAP,
  STEPS_PER_POINT,
  applyDeltaToSnapshot,
  dayFromSnapshot,
  dayKeyKst,
  emptySnapshot,
  resetTodayInSnapshot,
} from "@/lib/steps/earn";
import { subscribeStepSensor } from "@/lib/steps/sensor";
import { loadStepsSnapshot, saveStepsSnapshot } from "@/lib/steps/storage";
import type { StepsSnapshot } from "@/lib/steps/types";

type SensorMode = "pending" | "live" | "simulator";

/**
 * 만보기 → 포인트 프로토타입 패널.
 * 센서 가능하면 구독, 아니면 시뮬레이터로 걸음을 쌓아요.
 */
export function StepsPointsPanel() {
  const [snap, setSnap] = useState<StepsSnapshot>(emptySnapshot);
  const [ready, setReady] = useState(false);
  const [sensorMode, setSensorMode] = useState<SensorMode>("pending");
  const [toast, setToast] = useState("");

  const todayKey = dayKeyKst();
  const today = dayFromSnapshot(snap, todayKey);

  const commit = useCallback((next: StepsSnapshot, newlyEarned: number) => {
    setSnap(next);
    saveStepsSnapshot(next);
    if (newlyEarned > 0) {
      setToast(`+${newlyEarned}포인트 적립했어요`);
    }
  }, []);

  useEffect(() => {
    setSnap(loadStepsSnapshot());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let stop: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const result = await subscribeStepSensor(() => {
        setSnap((prev) => {
          const { snapshot, newlyEarned } = applyDeltaToSnapshot(
            prev,
            dayKeyKst(),
            1
          );
          saveStepsSnapshot(snapshot);
          if (newlyEarned > 0) {
            setToast(`+${newlyEarned}포인트 적립했어요`);
          }
          return snapshot;
        });
      });
      if (cancelled) {
        if (result.ok) result.stop();
        return;
      }
      if (result.ok) {
        stop = result.stop;
        setSensorMode("live");
      } else {
        setSensorMode("simulator");
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [ready]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  function addSteps(n: number) {
    const { snapshot, newlyEarned } = applyDeltaToSnapshot(snap, todayKey, n);
    commit(snapshot, newlyEarned);
  }

  function resetToday() {
    const next = resetTodayInSnapshot(snap, todayKey);
    commit(next, 0);
    setToast("오늘 걸음을 초기화했어요");
  }

  if (!ready) {
    return (
      <div
        className="h-48 animate-pulse rounded-mu-xl border border-mu-line bg-mu-card"
        aria-hidden
      />
    );
  }

  const rem = today.steps % STEPS_PER_POINT;
  const progressToNext = rem;
  const toNextPoint = rem === 0 ? STEPS_PER_POINT : STEPS_PER_POINT - rem;

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="오늘 걸음"
        className="overflow-hidden rounded-mu-xl border border-mu-line bg-mu-card p-5"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-mu-accent-soft text-mu-accent">
            <Footprints className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-mu-caption font-medium text-mu-fg-2">오늘 걸음</p>
            <p className="mu-num mt-1 text-3xl font-bold tracking-tight text-mu-fg">
              {today.steps.toLocaleString("ko-KR")}
            </p>
            <p className="mt-2 text-mu-caption text-mu-fg-3">
              {sensorMode === "live"
                ? "센서 연결됨 · 예시 정확도"
                : sensorMode === "simulator"
                  ? "시뮬레이터 모드 · 예시"
                  : "센서 확인 중…"}
            </p>
          </div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-mu-sunken">
          <div
            className="h-full rounded-full bg-mu-accent transition-[width] duration-mu-base"
            style={{
              width: `${Math.round((progressToNext / STEPS_PER_POINT) * 100)}%`,
            }}
          />
        </div>
        <p className="mt-2 text-mu-caption text-mu-fg-3">
          다음 포인트까지{" "}
          <span className="mu-num font-semibold text-mu-fg-2">
            {toNextPoint.toLocaleString("ko-KR")}
          </span>
          걸음 · {STEPS_PER_POINT.toLocaleString("ko-KR")}걸음 = 1포인트
        </p>
      </section>

      <section aria-label="포인트" className="grid grid-cols-2 gap-3">
        <div className="rounded-mu-xl border border-mu-line bg-mu-card p-4">
          <p className="text-mu-caption text-mu-fg-3">오늘 적립</p>
          <p className="mu-num mt-1 text-2xl font-bold text-mu-fg">
            {today.pointsEarnedToday}
            <span className="ml-1 text-mu-caption font-medium text-mu-fg-3">
              / {DAILY_POINT_CAP}
            </span>
          </p>
        </div>
        <div className="rounded-mu-xl border border-mu-line bg-mu-card p-4">
          <p className="text-mu-caption text-mu-fg-3">누적 포인트</p>
          <p className="mu-num mt-1 text-2xl font-bold text-mu-fg">
            {snap.lifetimePoints}
          </p>
        </div>
      </section>

      {sensorMode === "simulator" || sensorMode === "live" ? (
        <section
          aria-label="걸음 시뮬레이터"
          className="rounded-mu-xl border border-mu-line bg-mu-card p-4"
        >
          <p className="text-mu-label font-bold text-mu-fg">걸음 더하기</p>
          <p className="mt-1 text-mu-caption text-mu-fg-3">
            센서가 없거나 테스트할 때 써요. 가계부와는 연결되지 않아요.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => addSteps(500)}
            >
              +500걸음
            </Button>
            <Button className="w-full" onClick={() => addSteps(1000)}>
              +1000걸음
            </Button>
            <Button variant="ghost" className="w-full" onClick={resetToday}>
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
              오늘 리셋
            </Button>
          </div>
        </section>
      ) : null}

      {toast ? (
        <p role="status" className="text-center text-mu-caption text-mu-accent">
          {toast}
        </p>
      ) : null}
    </div>
  );
}
