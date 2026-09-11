import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { LearnBoard } from "@/components/learn-board";
import { LEARN_TOPICS } from "@/data/learn";
import { PageHeader } from "@/components/page-header";
import { Console, RailPanel } from "@/components/console";

export const dynamic = "force-dynamic";

export default async function LearnPage() {
  const session = await auth();
  const email = session?.user?.email ?? "";

  const rows = email
    ? await prisma.learnProgress.findMany({
        where: { ownerEmail: email },
        select: { key: true, status: true },
      })
    : [];
  const progress: Record<string, string> = {};
  for (const r of rows) progress[r.key] = r.status;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={<>Learn — tactics &amp; tasks</>} />

      <div className="mt-4">
        <Console
          rail={
            <RailPanel title="Learn">
              <p className="text-[13px] leading-relaxed text-gray-300">
                A personal roadmap of techniques to study. Each one says how to practice it right here in the portal — mark what you&apos;re learning and what you&apos;ve got down.
              </p>
              <ul className="mt-3 space-y-2 text-[11px] leading-relaxed text-gray-500">
                <li>Filter by category or status; tap a topic&apos;s buttons to set <b>to learn / learning / learned</b>.</li>
                <li>Use <b>Open in portal</b> to jump straight to where you can try it.</li>
                <li>Practice only on targets you own or are authorized to test.</li>
              </ul>
            </RailPanel>
          }
        >
      <LearnBoard topics={LEARN_TOPICS} progress={progress} />
        </Console>
      </div>
    </div>
  );
}
