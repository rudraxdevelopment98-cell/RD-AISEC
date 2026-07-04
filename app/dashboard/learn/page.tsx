import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { HelpBanner } from "@/components/hint";
import { LearnBoard } from "@/components/learn-board";
import { LEARN_TOPICS } from "@/data/learn";
import { PageHeader } from "@/components/page-header";

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
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={<>Learn — tactics &amp; tasks</>}
        subtitle="A personal roadmap of techniques to study. Each one says how to practice it right here in the portal. Mark what you're learning and what you've got down."
      />

      <HelpBanner>
        <p>• Filter by category or status; tap a topic&apos;s buttons to set <b>to learn / learning / learned</b>.</p>
        <p>• Use <b>Open in portal</b> to jump straight to where you can try it.</p>
        <p>• Practice only on targets you own or are authorized to test.</p>
      </HelpBanner>

      <LearnBoard topics={LEARN_TOPICS} progress={progress} />
    </div>
  );
}
