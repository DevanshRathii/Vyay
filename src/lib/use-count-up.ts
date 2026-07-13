"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_MS = 550;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Tweens a numeric value on change/mount — the "premium fintech dashboard"
 *  tell (Mercury, Wise) where a headline figure counts up instead of just
 *  appearing. Respects prefers-reduced-motion by jumping straight to target. */
export function useCountUp(target: number): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / DURATION_MS);
      setValue(from + (target - from) * easeOutCubic(t));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [target]);

  return value;
}
