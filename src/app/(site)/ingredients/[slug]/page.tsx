import { notFound } from "next/navigation";
import Link from "next/link";
import { getIngredientBySlug } from "@/lib/data/ingredients";

export const dynamic = "force-dynamic";
import DataTable, { Column } from "@/components/data-table";
import type {
  IngredientNutrient,
  IngredientAlias,
  IngredientMemberFood,
} from "@/types/fdc";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ingredient = await getIngredientBySlug(slug);
  return {
    title: ingredient
      ? `${ingredient.ingredientName} | Kyokon`
      : "Ingredient Not Found | Kyokon",
  };
}

const nutrientColumns: Column<IngredientNutrient>[] = [
  {
    key: "name",
    header: "Nutrient",
    cellClassName: "text-text-primary",
    render: (n) => (
      <>
        {n.name} <span className="text-text-muted">({n.unit})</span>
      </>
    ),
  },
  {
    key: "median",
    header: "Median",
    align: "right",
    cellClassName: "text-text-primary font-mono",
    render: (n) => n.median.toFixed(2),
  },
  {
    key: "p10",
    header: "P10",
    align: "right",
    cellClassName: "text-text-muted font-mono",
    render: (n) => (n.p10 !== null ? n.p10.toFixed(2) : "—"),
  },
  {
    key: "p25",
    header: "P25",
    align: "right",
    cellClassName: "text-text-muted font-mono",
    render: (n) => (n.p25 !== null ? n.p25.toFixed(2) : "—"),
  },
  {
    key: "p75",
    header: "P75",
    align: "right",
    cellClassName: "text-text-muted font-mono",
    render: (n) => (n.p75 !== null ? n.p75.toFixed(2) : "—"),
  },
  {
    key: "p90",
    header: "P90",
    align: "right",
    cellClassName: "text-text-muted font-mono",
    render: (n) => (n.p90 !== null ? n.p90.toFixed(2) : "—"),
  },
  {
    key: "min",
    header: "Min",
    align: "right",
    cellClassName: "text-text-muted font-mono",
    render: (n) => n.min.toFixed(2),
  },
  {
    key: "max",
    header: "Max",
    align: "right",
    cellClassName: "text-text-muted font-mono",
    render: (n) => n.max.toFixed(2),
  },
  {
    key: "nSamples",
    header: "Samples",
    align: "right",
    cellClassName: "text-text-muted tabular-nums",
    render: (n) => n.nSamples,
  },
];

const aliasColumns: Column<IngredientAlias>[] = [
  {
    key: "aliasNorm",
    header: "Alias",
    cellClassName: "text-text-primary",
    render: (a) => a.aliasNorm,
  },
  {
    key: "aliasCount",
    header: "Frequency",
    align: "right",
    cellClassName: "text-text-muted tabular-nums",
    render: (a) => a.aliasCount.toLocaleString(),
  },
  {
    key: "aliasSource",
    header: "Source",
    cellClassName: "text-text-muted",
    render: (a) => a.aliasSource,
  },
];

const memberFoodColumns: Column<IngredientMemberFood>[] = [
  {
    key: "fdcId",
    header: "FDC ID",
    width: "w-24",
    cellClassName: "font-mono",
    render: (f) => (
      <Link
        href={`/foods/${f.fdcId}`}
        className="text-text-link hover:text-text-link-hover"
      >
        {f.fdcId}
      </Link>
    ),
  },
  {
    key: "description",
    header: "Description",
    cellClassName: "text-text-primary",
    render: (f) => f.description,
  },
  {
    key: "dataType",
    header: "Type",
    width: "w-32",
    cellClassName: "text-text-muted",
    render: (f) => f.dataType ?? "—",
  },
  {
    key: "membershipReason",
    header: "Match Reason",
    width: "w-36",
    cellClassName: "text-text-muted",
    render: (f) => f.membershipReason,
  },
];

export default async function IngredientDetailPage({ params }: Props) {
  const { slug } = await params;
  const ingredient = await getIngredientBySlug(slug);

  if (!ingredient) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/ingredients"
          className="text-sm text-text-link hover:text-text-link-hover"
        >
          &larr; Back to Synthetic Ingredients
        </Link>
      </div>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-text-primary">
            {ingredient.ingredientName}
          </h1>
          <a
            href={`/api/ingredients/${ingredient.ingredientSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-sm border border-border-default text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors"
          >
            JSON
          </a>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-secondary">
          <span>
            Slug:{" "}
            <span className="font-mono text-text-muted">
              {ingredient.ingredientSlug}
            </span>
          </span>
          <span>
            Rank:{" "}
            <span className="tabular-nums">
              #{ingredient.canonicalRank.toLocaleString()}
            </span>
          </span>
          <span>
            Recipe frequency:{" "}
            <span className="tabular-nums">
              {ingredient.frequency.toLocaleString()}
            </span>
          </span>
          <span>
            Mapped foods:{" "}
            <span className="tabular-nums">
              {ingredient.fdcCount.toLocaleString()}
            </span>
          </span>
          {ingredient.syntheticFdcId && (
            <span>
              Synthetic FDC ID:{" "}
              <span className="font-mono text-text-muted">
                {ingredient.syntheticFdcId}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Nutrient Profile */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">
          Nutrient Profile ({ingredient.nutrients.length})
        </h2>
        <p className="text-sm text-text-secondary">
          Statistical aggregates per 100g computed from{" "}
          {ingredient.fdcCount} mapped FDC foods. Median is the central
          estimate; P10–P90 shows the range across source foods.
        </p>

        <DataTable
          columns={nutrientColumns}
          data={ingredient.nutrients}
          keyExtractor={(n) => n.nutrientId}
          emptyMessage="No nutrient data computed yet. Run aggregate-recipe-nutrients.ts to populate."
          striped
        />
      </section>

      {/* Aliases (provenance) */}
      {ingredient.aliases.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-text-primary">
            Aliases ({ingredient.aliases.length})
          </h2>
          <p className="text-sm text-text-secondary">
            Variant names from recipe corpora that resolve to this canonical
            ingredient. Each alias is a real string written by recipe authors,
            with its corpus frequency.
          </p>

          <DataTable
            columns={aliasColumns}
            data={ingredient.aliases}
            keyExtractor={(a) => a.aliasNorm}
            striped
          />
        </section>
      )}

      {/* Member Foods (provenance) */}
      {ingredient.memberFoods.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-text-primary">
            Mapped FDC Foods ({ingredient.memberFoods.length})
          </h2>
          <p className="text-sm text-text-secondary">
            USDA FoodData Central entries mapped to this ingredient. The nutrient
            profile above is computed from these foods. Match reason shows how
            the mapping was established.
          </p>

          <DataTable
            columns={memberFoodColumns}
            data={ingredient.memberFoods}
            keyExtractor={(f) => f.fdcId}
            striped
          />
        </section>
      )}
    </div>
  );
}
