import Link from "next/link";
import { auth } from "@/auth";
import { TOOLS, CATEGORIES } from "@/data/tools";

export default async function DashboardOverview() {
  const session = await auth();
  const firstName = session?.user?.name?.split(" ")[0] ?? "operator";

  const stats = [
    { label: "Tools in catalog", value: TOOLS.length },
    { label: "Categories", value: CATEGORIES.length },
    {
      label: "Open source",
      value: TOOLS.filter((t) => t.license === "Open Source").length,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold">Welcome back, {firstName} 👋</h1>
      <p className="mt-2 text-gray-400">
        Pick a tool or technique and learn how to test it, exploit it, and —
        most importantly — protect, find, and fix it.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <p className="text-3xl font-bold text-brand">{s.value}</p>
            <p className="mt-1 text-sm text-gray-400">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link href="/dashboard/assistant" className="card hover:border-brand">
          <h3 className="font-semibold text-brand-glow">Ask the AI Assistant →</h3>
          <p className="mt-2 text-sm text-gray-300">
            Describe a tool, technique, or vulnerability and get a structured
            how-to-and-how-to-defend breakdown.
          </p>
        </Link>
        <Link href="/dashboard/tools" className="card hover:border-brand">
          <h3 className="font-semibold text-brand-glow">Browse the Tool Catalog →</h3>
          <p className="mt-2 text-sm text-gray-300">
            Search modern open-source and paid security tools by name or
            category.
          </p>
        </Link>
      </div>

      <p className="mt-10 text-xs text-gray-500">
        Reminder: only assess systems you own or are explicitly authorized to
        test.
      </p>
    </div>
  );
}
