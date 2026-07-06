import { useEffect, useRef } from "react";

/** Keep the screen awake while `active` (e.g., during a drive). Best-effort. */
export function useWakeLock(active: boolean): void {
  const lock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function request() {
      try {
        if ("wakeLock" in navigator && active) {
          lock.current = await (navigator as Navigator & {
            wakeLock: { request: (t: "screen") => Promise<WakeLockSentinel> };
          }).wakeLock.request("screen");
        }
      } catch {
        /* wake lock unsupported or denied — ignore */
      }
    }

    async function release() {
      try {
        await lock.current?.release();
      } catch {
        /* ignore */
      }
      lock.current = null;
    }

    if (active) {
      request();
      const onVisible = () => {
        if (document.visibilityState === "visible" && active && !cancelled) request();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        cancelled = true;
        document.removeEventListener("visibilitychange", onVisible);
        release();
      };
    } else {
      release();
    }
  }, [active]);
}
