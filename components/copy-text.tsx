"use client";

import { useState } from "react";

/** A button that copies the given text to the clipboard. */
export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked — ignore */
        }
      }}
      className="btn-ghost px-2 py-1 text-xs"
    >
      {done ? "✓ Copied" : label}
    </button>
  );
}
