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
      <hr className="hairline my-6" />
      <ToolCatalog tools={TOOLS} categories={CATEGORIES} />
    </div>
  );
}
