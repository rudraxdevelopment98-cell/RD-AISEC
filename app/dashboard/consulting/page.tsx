import { notFound } from "next/navigation";
import { PillarView } from "@/components/pillar-view";
import { getPillar } from "@/data/portal";

export default function ConsultingPage() {
  const pillar = getPillar("consulting");
  if (!pillar) notFound();
  return <PillarView pillar={pillar} />;
}
