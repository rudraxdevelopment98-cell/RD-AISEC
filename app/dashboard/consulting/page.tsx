import { notFound } from "next/navigation";
import { PillarView } from "@/components/pillar-view";
import { getPillar } from "@/data/portal";
import { pillarEngagements } from "@/lib/pillars";

export const dynamic = "force-dynamic";

export default async function ConsultingPage() {
  const pillar = getPillar("consulting");
  if (!pillar) notFound();
  const engagements = await pillarEngagements("consulting");
  return <PillarView pillar={pillar} engagements={engagements} />;
}
