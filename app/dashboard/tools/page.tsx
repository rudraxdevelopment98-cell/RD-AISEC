import { TOOLS, CATEGORIES } from "@/data/tools";
import { ToolCatalog } from "./catalog";

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Tool Catalog</h1>
      <p className="mt-2 text-gray-400">
        Modern open-source and paid security tools. Search by name, or filter by
        category.
      </p>
      <ToolCatalog tools={TOOLS} categories={CATEGORIES} />
    </div>
  );
}
