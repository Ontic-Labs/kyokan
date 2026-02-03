import { notFound } from "next/navigation";
import Link from "next/link";
import { getFoodDetail } from "@/lib/data/foods";

export const dynamic = "force-dynamic";
import NutrientTable from "@/components/nutrient-table";
import DataTable, { Column } from "@/components/data-table";
import type { Metadata } from "next";

interface Portion {
  gramWeight: number;
  amount: number | null;
  unit: string | null;
  modifier: string | null;
}

const portionColumns: Column<Portion>[] = [
  {
    key: "gramWeight",
    header: "Gram Weight",
    align: "right",
    render: (p) => <span className="font-mono">{p.gramWeight}g</span>,
  },
  {
    key: "amount",
    header: "Amount",
    align: "right",
    render: (p) => <span className="font-mono">{p.amount ?? "—"}</span>,
  },
  {
    key: "unit",
    header: "Unit",
    render: (p) => <span className="text-text-secondary">{p.unit ?? "—"}</span>,
  },
  {
    key: "modifier",
    header: "Modifier",
    render: (p) => <span className="text-text-muted">{p.modifier ?? "—"}</span>,
  },
];

interface Props {
  params: Promise<{ fdcId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { fdcId } = await params;
  const food = await getFoodDetail(Number(fdcId));
  return {
    title: food
      ? `${food.description} | Kyokon`
      : "Food Not Found | Kyokon",
  };
}

export default async function FoodDetailPage({ params }: Props) {
  const { fdcId } = await params;
  const food = await getFoodDetail(Number(fdcId));

  if (!food) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/foods"
          className="text-sm text-text-link hover:text-text-link-hover"
        >
          &larr; Back to search
        </Link>
      </div>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-text-primary">
            {food.description}
          </h1>
          <a
            href={`/api/foods/${food.fdcId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-sm border border-border-default text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors"
          >
            JSON
          </a>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
          <span>
            FDC ID:{" "}
            <span className="font-mono text-text-muted">{food.fdcId}</span>
          </span>
          <span>Data type: {food.dataType}</span>
          {food.publishedDate && <span>Published: {food.publishedDate}</span>}
          {food.category && (
            <span>
              Category:{" "}
              <Link
                href={`/categories/${food.category.categoryId}`}
                className="text-text-link hover:text-text-link-hover"
              >
                {food.category.name}
              </Link>
            </span>
          )}
          {food.canonicalBaseName && (
            <span>
              Canonical:{" "}
              <Link
                href={`/foods?canonicalSlug=${food.canonicalBaseSlug}`}
                className="text-text-link hover:text-text-link-hover"
              >
                {food.canonicalBaseName}
              </Link>
              {food.canonicalSpecificName &&
                food.canonicalSpecificName !== food.canonicalBaseName && (
                  <>
                    {" / "}
                    <Link
                      href={`/foods?canonicalSlug=${food.canonicalSpecificSlug}`}
                      className="text-text-link hover:text-text-link-hover"
                    >
                      {food.canonicalSpecificName}
                    </Link>
                  </>
                )}
            </span>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-primary">
          Nutrients ({food.nutrients.length})
        </h2>
        <NutrientTable nutrients={food.nutrients} />
      </section>

      {food.portions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-text-primary">
            Portions ({food.portions.length})
          </h2>
          <DataTable
            columns={portionColumns}
            data={food.portions}
            keyExtractor={(p) =>
              `${p.gramWeight}-${p.amount ?? "na"}-${p.unit ?? "na"}-${p.modifier ?? "na"}`
            }
            striped
            minWidthClass="min-w-112.5"
          />
        </section>
      )}
    </div>
  );
}
