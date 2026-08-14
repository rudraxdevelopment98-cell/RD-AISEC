"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animate a number from 0 → value on mount (and whenever value changes). Gives the
 * live-ops rail its "cockpit" feel. Respects prefers-reduced-motion (snaps to the
 * value). Purely presentational — the value is computed server-side.
 */
export function CountUp({
  value,
  duration = 700,
  className = "",
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const [n, setN] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || value === from.current) {
      setN(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const startVal = from.current;
    const delta = value - startVal;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(startVal + delta * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={`tabular ${className}`}>{n}</span>;
}
