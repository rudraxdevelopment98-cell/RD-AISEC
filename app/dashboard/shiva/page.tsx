import Link from "next/link";
import { Icon } from "@/components/icons";
import { listShivaDocs } from "@/lib/shiva";

export const dynamic = "force-dynamic";

export default function ShivaIndex() {
  const docs = listShivaDocs();
  const groups = Array.from(new Set(docs.map((d) => d.group)));

  return (
    <div className="mx-auto max-w-4xl">
      <p className="tag ring-sky accent-sky">Research project</p>
      <h1 className="mt-3 text-2xl font-bold">Shiva — MCP / Agent-Tool Security</h1>
      <p className="mt-2 text-gray-400">
        The control room for securing the Model Context Protocol: the detection
        and policy layer where tools meet AI agents. Plan, progress, threat
        model, and attack research — rendered live with diagrams.
      </p>

      {groups.map((group) => (
        <section key={group} className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            {group}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {docs
              .filter((d) => d.group === group)
              .map((d) => (
                <Link
                  key={d.slug}
                  href={`/dashboard/shiva/${d.slug}`}
                  className="card-hover flex items-center justify-between gap-3"
                >
                  <span className="font-medium text-white">{d.title}</span>
                  <Icon name="arrow" className="h-4 w-4 text-brand" />
                </Link>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
