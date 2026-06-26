"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";

type NavLink = { label: string; href: string; section: string };
type Hit = { id: string; name: string };

/**
 * Quick-jump: a button (and Ctrl/⌘+K) that opens a search palette to jump to any
 * section, engagement, or bug-bounty program. Sections are filtered client-side
 * from the user's allowed nav; engagements/programs come from /api/search.
 */
export function CommandPalette({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [eng, setEng] = useState<Hit[]>([]);
  const [progs, setProgs] = useState<(Hit & { engagementId: string | null })[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Open on Ctrl/⌘+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else {
      setQ("");
      setEng([]);
      setProgs([]);
    }
  }, [open]);

  // Debounced remote search for engagements/programs.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) {
      setEng([]);
      setProgs([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        if (!res.ok) return;
        const data = await res.json();
        setEng(data.engagements ?? []);
        setProgs(data.programs ?? []);
      } catch {
        /* ignore */
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const ql = q.trim().toLowerCase();
  const navHits = (ql ? links.filter((l) => l.label.toLowerCase().includes(ql)) : links).slice(0, 8);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-surface-border px-2.5 py-1.5 text-xs text-gray-400 hover:border-brand hover:text-gray-200"
        aria-label="Search"
      >
        <Icon name="search" className="h-4 w-4" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="hidden rounded border border-surface-border px-1 text-[10px] text-gray-500 sm:inline">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="glass-panel relative w-full max-w-lg rounded-xl border border-surface-border shadow-2xl">
            <div className="flex items-center gap-2 border-b border-surface-border px-3 py-2.5">
              <Icon name="search" className="h-4 w-4 text-gray-500" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Jump to a section, engagement, or program…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-500"
              />
              <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-white">esc</button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-2 text-sm">
              {navHits.length > 0 && (
                <Section title="Sections">
                  {navHits.map((l) => (
                    <Row key={l.href} onClick={() => go(l.href)} icon="arrow" label={l.label} sub={l.section} />
                  ))}
                </Section>
              )}
              {eng.length > 0 && (
                <Section title="Engagements">
                  {eng.map((e) => (
                    <Row key={e.id} onClick={() => go(`/dashboard/engagements/${e.id}`)} icon="briefcase" label={e.name} />
                  ))}
                </Section>
              )}
              {progs.length > 0 && (
                <Section title="Bug bounty programs">
                  {progs.map((p) => (
                    <Row
                      key={p.id}
                      onClick={() => go(p.engagementId ? `/dashboard/engagements/${p.engagementId}` : "/dashboard/bugbounty")}
                      icon="target"
                      label={p.name}
                    />
                  ))}
                </Section>
              )}
              {navHits.length === 0 && eng.length === 0 && progs.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-gray-500">No matches.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600">{title}</p>
      {children}
    </div>
  );
}

function Row({ onClick, icon, label, sub }: { onClick: () => void; icon: string; label: string; sub?: string }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-card/60">
      <Icon name={icon} className="h-4 w-4 shrink-0 text-brand" />
      <span className="flex-1 truncate text-gray-200">{label}</span>
      {sub && <span className="shrink-0 text-[10px] text-gray-600">{sub}</span>}
    </button>
  );
}
