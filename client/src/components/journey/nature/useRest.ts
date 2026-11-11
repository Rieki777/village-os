/**
 * THE REST. Ambient fireflies stop drifting after about twenty seconds
 * without input and wake on the next one (the wave 2 motion rule). Input is
 * a pointer moving or pressing, a key, a touch or a scroll; every listener is
 * passive, so resting costs a page nothing.
 */
import { useEffect, useState } from "react";

export const REST_AFTER_MS = 20_000;

const WAKERS = ["pointermove", "pointerdown", "keydown", "touchstart", "scroll", "wheel"] as const;

/** True once `ms` pass with no input; false again on the next input. Off when `enabled` is false. */
export function useRest(enabled: boolean, ms: number = REST_AFTER_MS): boolean {
  const [resting, setResting] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => setResting(true), ms);
    };
    const wake = () => {
      setResting(false);
      arm();
    };
    arm();
    for (const e of WAKERS) window.addEventListener(e, wake, { passive: true });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const e of WAKERS) window.removeEventListener(e, wake);
    };
  }, [enabled, ms]);
  return enabled && resting;
}
