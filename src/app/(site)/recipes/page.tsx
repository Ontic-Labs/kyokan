import { Suspense } from "react";
import Link from "next/link";
import { searchRecipes } from "@/lib/data/recipes";
import DataTable, { Column } from "@/components/data-table";
import SortableHeader from "@/components/sortable-header";
import TableFilterBar from "@/components/table-filter-bar";
import Pagination from "@/components/pagination";
import Breadcrumb from "@/components/breadcrumb";
import type { RecipeListItem } from "@/lib/data/recipes";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Recipes",
  description:
    "Browse 990 top-rated Food.com recipes with ingredient analysis and cooking method extraction.",
  openGraph: {
    title: "Recipes | Kyokon",
    description: "Browse top-rated recipes with detailed ingredient analysis.",
    url: "/recipes",
  },
  alternates: {
    canonical: "/recipes",
  },
};

function RatingBadge({ rating }: { rating: number | string }) {
  const r = Number(rating);
  const color =
    r >= 4.7
      ? "bg-status-success-bg text-status-success"
      : r >= 4.5
        ? "bg-status-warning-bg text-status-warning"
        : "bg-surface-raised text-text-muted";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      ★ {r.toFixed(2)}
    </span>
  );
}

function MatchRateBadge({ rate }: { rate: number | string }) {
  const pct = Math.round(Number(rate) * 100);
  const color =
    pct >= 95
      ? "bg-status-success-bg text-status-success"
      : pct >= 80
        ? "bg-status-warning-bg text-status-warning"
        : "bg-status-error-bg text-status-error";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {pct}%
    </span>
  );
}

const columns: Column<RecipeListItem>[] = [
  {
    key: "name",
    header: "Name",
    render: (item) => (
      <Link
        href={`/recipes/${item.recipe_id}`}
        className="text-link-default hover:text-link-hover hover:underline font-medium"
      >
        {item.name}
      </Link>
    ),
    renderHeader: () => <SortableHeader column="name" label="Name" />,
  },
  {
    key: "minutes",
    header: "Time",
    align: "right",
    width: "w-20",
    render: (item) => (
      <span className="text-text-secondary">
        {item.minutes ? `${item.minutes}m` : "—"}
      </span>
    ),
    renderHeader: () => <SortableHeader column="minutes" label="Time" />,
  },
  {
    key: "n_ingredients",
    header: "Ingredients",
    align: "right",
    width: "w-24",
    render: (item) => (
      <span className="text-text-secondary">{item.n_ingredients ?? "—"}</span>
    ),
    renderHeader: () => (
      <SortableHeader column="n_ingredients" label="Ingredients" />
    ),
  },
  {
    key: "avg_rating",
    header: "Rating",
    align: "right",
    width: "w-20",
    render: (item) => <RatingBadge rating={item.avg_rating} />,
    renderHeader: () => <SortableHeader column="avg_rating" label="Rating" />,
  },
  {
    key: "review_count",
    header: "Reviews",
    align: "right",
    width: "w-24",
    render: (item) => (
      <span className="text-text-secondary">{item.review_count}</span>
    ),
    renderHeader: () => (
      <SortableHeader column="review_count" label="Reviews" />
    ),
  },
  {
    key: "match_rate",
    header: "Mapped",
    align: "right",
    width: "w-20",
    render: (item) => <MatchRateBadge rate={item.match_rate} />,
    renderHeader: () => <SortableHeader column="match_rate" label="Mapped" />,
  },
];

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;

  const results = await searchRecipes({
    q: params.q || undefined,
    minRating: params.minRating ? Number(params.minRating) : undefined,
    sortBy: params.sortBy || "review_count",
    sortDir: params.sortDir === "asc" ? "asc" : "desc",
    page: params.page ? Number(params.page) : 1,
    pageSize: 25,
  });

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Recipes" }]} />

      <div>
        <h1 className="text-2xl font-bold text-text-primary">Recipes</h1>
        <p className="text-sm text-text-secondary mt-1 max-w-2xl">
          Browse {results.total.toLocaleString()} top-rated Food.com recipes.
          Each recipe has been analyzed for ingredient mapping to USDA FoodData
          Central and cooking method extraction.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="h-12 animate-pulse bg-surface-raised rounded-md" />
        }
      >
        <TableFilterBar
          basePath="/recipes"
          queryParam="q"
          queryPlaceholder="Search recipes..."
        />
      </Suspense>

      <Suspense
        fallback={
          <div className="h-64 animate-pulse bg-surface-raised rounded-md" />
        }
      >
        <DataTable
          columns={columns}
          data={results.items}
          keyExtractor={(item) => item.recipe_id}
          emptyMessage="No recipes found."
          maxHeightClass="max-h-[70vh]"
        />
      </Suspense>

      <Suspense fallback={null}>
        <Pagination
          total={results.total}
          page={results.page}
          pageSize={results.pageSize}
        />
      </Suspense>
    </div>
  );
}
