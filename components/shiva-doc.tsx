"use client";

import { useEffect, useRef, useState } from "react";
import type { DocSegment } from "@/lib/shiva";

let initialized = false;

function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Load mermaid in the browser only — it touches DOM APIs on import.
    import("mermaid").then(({ default: mermaid }) => {
      if (!initialized) {
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          themeVariables: { fontFamily: "ui-sans-serif, system-ui" },
        });
        initialized = true;
      }
      const id = "mmd-" + Math.random().toString(36).slice(2);
      mermaid
        .render(id, code)
        .then(({ svg }) => {
          if (!cancelled && ref.current) ref.current.innerHTML = svg;
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <pre className="overflow-x-auto rounded-lg border border-surface-border bg-black/50 p-3 font-mono text-xs text-gray-400">
        {code}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="my-4 grid place-items-center overflow-x-auto rounded-lg border border-surface-border bg-black/30 p-4"
    />
  );
}

export function ShivaDoc({ segments }: { segments: DocSegment[] }) {
  return (
    <div>
      {segments.map((seg, i) =>
        seg.type === "mermaid" ? (
          <Mermaid key={i} code={seg.code} />
        ) : (
          <div
            key={i}
            className="prose-shiva text-sm leading-relaxed text-gray-300 [&_a]:text-brand [&_a:hover]:underline [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-white [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-brand-glow [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-white [&_li]:ml-5 [&_li]:list-disc [&_li]:marker:text-gray-600 [&_ol_li]:list-decimal [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-surface-border [&_pre]:bg-black/50 [&_pre]:p-3 [&_pre]:text-xs [&_strong]:text-white [&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_td]:border [&_td]:border-surface-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-surface-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-gray-400"
            dangerouslySetInnerHTML={{ __html: seg.html }}
          />
        ),
      )}
    </div>
  );
}
