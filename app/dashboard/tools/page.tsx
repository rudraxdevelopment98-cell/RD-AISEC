import { TOOLS, CATEGORIES } from "@/data/tools";
import { ToolCatalog } from "./catalog";
import { PageHeader } from "@/components/page-header";

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Tool Catalog"
        subtitle="Modern open-source and paid security tools. Search by name, or filter by category."
      />
      <ToolCatalog tools={TOOLS} categories={CATEGORIES} />
    </div>
  );
}
