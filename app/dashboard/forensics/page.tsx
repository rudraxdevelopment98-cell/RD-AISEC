import { notFound } from "next/navigation";
import { PillarView } from "@/components/pillar-view";
import { getPillar } from "@/data/portal";
import { pillarEngagements } from "@/lib/pillars";

export const dynamic = "force-dynamic";

export default async function ForensicsPage() {
  const pillar = getPillar("forensics");
  if (!pillar) notFound();
  const engagements = await pillarEngagements("forensics");
  return <PillarView pillar={pillar} engagements={engagements} />;
}
