import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { HelpBanner } from "@/components/hint";
import { ExploitLab } from "@/components/exploit-lab";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const [runners, cfg] = await Promise.all([
    prisma.runner.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
    prisma.notifySetting.findFirst(),
  ]);
  const exploitDir = cfg?.exploitDir ?? "";
  const driveUrl = cfg?.driveUrl ?? "";

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold">Exploit Lab</h1>
      <p className="mt-1 max-w-2xl text-gray-400">
        Build PoCs and exploits from templates, then save them straight into your
        Kali exploit folder. Keep research and notes in your linked Drive.
      </p>

      <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        <Icon name="alert" className="mr-1 inline h-4 w-4" />
        For authorized testing on systems you own or are permitted to test only.
      </div>

      <HelpBanner>
        <p>• Pick a template, fill the fields, <b>Generate</b>, edit if needed.</p>
        <p>• <b>Save</b> writes it into your Kali exploit folder on the chosen machine (set the folder in Settings).</p>
        <p>• Run saved exploits from Jobs (custom command) or the Exploit console.</p>
      </HelpBanner>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        {driveUrl ? (
          <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-sm">
            <Icon name="book" className="h-4 w-4" /> Open research Drive
          </a>
        ) : (
          <Link href="/dashboard/settings" className="text-xs text-gray-500 hover:text-brand">
            Set a Google Drive link in Settings →
          </Link>
        )}
        {exploitDir ? (
          <span className="tag font-mono">📁 {exploitDir}</span>
        ) : (
          <Link href="/dashboard/settings" className="text-xs text-gray-500 hover:text-brand">
            Set a Kali exploit folder in Settings →
          </Link>
        )}
      </div>

      <ExploitLab runners={runners} exploitDir={exploitDir} />
    </div>
  );
}
