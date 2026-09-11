import { TOOLS, CATEGORIES } from "@/data/tools";
import { ToolCatalog } from "./catalog";
import { PageHeader } from "@/components/page-header";
import { Console, RailPanel } from "@/components/console";

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Tool Catalog" />

      <div className="mt-4">
        <Console
          rail={
            <RailPanel title="Tool Catalog">
              <p className="text-[13px] leading-relaxed text-gray-300">
                Modern open-source and paid security tools. Search by name, or filter by category.
              </p>
            </RailPanel>
          }
        >
          <ToolCatalog tools={TOOLS} categories={CATEGORIES} />
        </Console>
      </div>
    </div>
  );
}
