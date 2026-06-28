import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { HelpBanner } from "@/components/hint";
import { LearnBoard } from "@/components/learn-board";
import { LEARN_TOPICS } from "@/data/learn";

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
      <h1 className="text-2xl font-bold">Learn — tactics &amp; tasks</h1>
      <p className="mt-1 text-gray-400">
        A personal roadmap of techniques to study. Each one says how to practice
        it right here in the portal. Mark what you&apos;re learning and what
        you&apos;ve got down.
      </p>

      <HelpBanner>
        <p>• Filter by category or status; tap a topic&apos;s buttons to set <b>to learn / learning / learned</b>.</p>
        <p>• Use <b>Open in portal</b> to jump straight to where you can try it.</p>
        <p>• Practice only on targets you own or are authorized to test.</p>
      </HelpBanner>

      <LearnBoard topics={LEARN_TOPICS} progress={progress} />
    </div>
  );
}
