"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically re-fetches the current server component tree so live data (job
 * status, runner last-seen) stays fresh — but ONLY while the tab is visible, so
 * it never reloads a page you've left open in the background or aren't looking
 * at. Mount it conditionally (e.g. only while a job is running) so a static page
 * doesn't refresh under you.
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const period = Math.max(5, seconds) * 1000;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id == null) id = setInterval(() => router.refresh(), period);
    };
    const stop = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    // Only run when the page is actually on screen.
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, seconds]);
  return null;
}
