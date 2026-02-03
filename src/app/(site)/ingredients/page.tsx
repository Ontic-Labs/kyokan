import Link from "next/link";
import { searchIngredients } from "@/lib/data/ingredients";
import Pagination from "@/components/pagination";
import DataTable, { Column } from "@/components/data-table";
import SortableHeader from "@/components/sortable-header";
import TableFilterBar from "@/components/table-filter-bar";
import type { IngredientListItem } from "@/types/fdc";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ingredients | Kyokon",
};

const columns: Column<IngredientListItem>[] = [
  {
    key: "name",
    header: "Ingredient",
    renderHeader: () => (
      <SortableHeader column="name" label="Ingredient" />
    ),
    render: (item) => (
      <Link
        href={`/ingredients/${item.ingredientSlug}`}
        className="text-text-link hover:text-text-link-hover hover:underline underline-offset-2"
      >
        {item.ingredientName}
      </Link>
    ),
  },
  {
    key: "frequency",
    header: "Frequency",
    align: "right",
    width: "w-24",
    cellClassName: "text-text-muted tabular-nums",
    renderHeader: () => (
      <SortableHeader column="frequency" label="Frequency" />
    ),
    render: (item) => item.frequency.toLocaleString(),
  },
  {
    key: "foods",
    header: "Foods",
    align: "right",
    width: "w-24",
    cellClassName: "text-text-muted tabular-nums",
    renderHeader: () => <SortableHeader column="foods" label="Foods" />,
    render: (item) => item.fdcCount.toLocaleString(),
  },
  {
    key: "nutrients",
    header: "Nutrients",
    align: "center",
    width: "w-24",
    renderHeader: () => (
      <SortableHeader column="nutrients" label="Nutrients" />
    ),
    render: (item) =>
      item.hasNutrients ? (
        <span className="text-accent-success">✓</span>
      ) : (
        <span className="text-text-muted">—</span>
      ),
  },
];

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;

  const sortBy =
    params.sortBy &&
    ["name", "frequency", "foods", "nutrients"].includes(params.sortBy)
      ? (params.sortBy as "name" | "frequency" | "foods" | "nutrients")
      : undefined;
  const sortDir = params.sortDir === "desc" ? "desc" : "asc";

  const results = await searchIngredients({
    q: params.q || undefined,
    hasNutrients: params.hasNutrients === "true" ? true : undefined,
    sortBy,
    sortDir,
    page: params.page ? Number(params.page) : 1,
    pageSize: 50,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Canonical Ingredients
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {results.total.toLocaleString()} recipe-first ingredients mapped to FDC foods with aggregated nutrient boundaries
          </p>
        </div>
        <a
          href="/api/ingredients/export"
          download="kyokon-synthetic-ingredients.json"
          className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-sm border border-border-default text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors"
        >
          Download JSON
        </a>
      </div>

      <TableFilterBar
        basePath="/ingredients"
        queryParam="q"
        queryPlaceholder="Search ingredients (e.g., ground beef, olive oil)..."
        showHasNutrients
      />

      <DataTable
        columns={columns}
        data={results.items}
        keyExtractor={(item) => item.canonicalId}
        emptyMessage="No ingredients found matching your search."
      />

      <Pagination
        total={results.total}
        page={results.page}
        pageSize={results.pageSize}
      />
    </div>
  );
}
