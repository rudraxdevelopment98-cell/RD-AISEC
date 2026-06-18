import { notFound } from "next/navigation";
import { PillarView } from "@/components/pillar-view";
import { getPillar } from "@/data/portal";

export default function ForensicsPage() {
  const pillar = getPillar("forensics");
  if (!pillar) notFound();
  return <PillarView pillar={pillar} />;
}
