import Link from "next/link";
import { notFound } from "next/navigation";
import { getShivaDoc, listShivaDocs } from "@/lib/shiva";
import { ShivaDoc } from "@/components/shiva-doc";

export const dynamic = "force-dynamic";

export default function ShivaDocPage({ params }: { params: { slug: string } }) {
  const doc = getShivaDoc(params.slug);
  if (!doc) notFound();
  const docs = listShivaDocs();

  return (
    <div className="mx-auto flex max-w-6xl gap-8">
      {/* Secondary doc nav */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <Link
          href="/dashboard/shiva"
          className="text-sm text-gray-500 hover:text-brand"
        >
          ← Shiva home
        </Link>
        <nav className="mt-4 space-y-0.5">
          {docs.map((d) => {
            const active = d.slug === params.slug;
            return (
              <Link
                key={d.slug}
                href={`/dashboard/shiva/${d.slug}`}
                className={`block rounded-md px-2 py-1.5 text-sm transition ${
                  active
                    ? "bg-brand/10 text-brand"
                    : "text-gray-400 hover:bg-surface-border/60 hover:text-white"
                }`}
              >
                {d.title}
              </Link>
            );
          })}
        </nav>
      </aside>

      <article className="min-w-0 flex-1">
        <Link
          href="/dashboard/shiva"
          className="text-sm text-gray-500 hover:text-brand lg:hidden"
        >
          ← Shiva home
        </Link>
        <div className="card mt-3 lg:mt-0">
          <ShivaDoc segments={doc.segments} />
        </div>
      </article>
    </div>
  );
}
