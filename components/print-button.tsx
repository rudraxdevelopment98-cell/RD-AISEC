"use client";

import { Icon } from "@/components/icons";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-ghost">
      <Icon name="book" className="h-4 w-4" /> Print / Save as PDF
    </button>
  );
}
