import type { SensorSubscribeResult } from "@/lib/steps/types";

type MotionPermission = {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
};

/**
 * 브라우저 만보기/모션 센서 구독.
 * 지원·권한이 없으면 ok:false. 가능하면 가속도 피크로 거친 걸음 콜백.
 */
export async function subscribeStepSensor(
  onStep: () => void
): Promise<SensorSubscribeResult> {
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return { ok: false, reason: "unsupported" };
  }

  const Motion = window.DeviceMotionEvent as
    | (typeof DeviceMotionEvent & MotionPermission)
    | undefined;

  if (!Motion) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    if (typeof Motion.requestPermission === "function") {
      const perm = await Motion.requestPermission();
      if (perm !== "granted") {
        return { ok: false, reason: "denied" };
      }
    }
  } catch {
    return { ok: false, reason: "denied" };
  }

  let lastMag = 0;
  let lastStepAt = 0;
  const handler = (ev: DeviceMotionEvent) => {
    const a = ev.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    const now = Date.now();
    // 거친 피크 감지 — 프로토타입용, 정확도 보장 없음
    if (mag - lastMag > 1.8 && now - lastStepAt > 320) {
      lastStepAt = now;
      onStep();
    }
    lastMag = mag;
  };

  window.addEventListener("devicemotion", handler);
  return {
    ok: true,
    stop: () => window.removeEventListener("devicemotion", handler),
  };
}
