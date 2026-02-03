import Link from "next/link";
import { searchIngredients } from "@/lib/data/ingredients";
import IngredientSearchForm from "@/components/ingredient-search-form";
import Pagination from "@/components/pagination";
import DataTable, { Column } from "@/components/data-table";
import type { IngredientListItem } from "@/types/fdc";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ingredients | Kyokon",
};

const columns: Column<IngredientListItem>[] = [
  {
    key: "name",
    header: "Ingredient",
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
    render: (item) => item.frequency.toLocaleString(),
  },
  {
    key: "foods",
    header: "Foods",
    align: "right",
    width: "w-24",
    cellClassName: "text-text-muted tabular-nums",
    render: (item) => item.fdcCount.toLocaleString(),
  },
  {
    key: "nutrients",
    header: "Nutrients",
    align: "center",
    width: "w-24",
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

  const results = await searchIngredients({
    q: params.q || undefined,
    hasNutrients: params.hasNutrients === "true" ? true : undefined,
    page: params.page ? Number(params.page) : 1,
    pageSize: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          Canonical Ingredients
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {results.total.toLocaleString()} recipe-first ingredients mapped to FDC foods with aggregated nutrient boundaries
        </p>
      </div>

      <IngredientSearchForm />

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
