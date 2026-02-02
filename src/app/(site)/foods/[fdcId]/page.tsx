import { notFound } from "next/navigation";
import Link from "next/link";
import { getFoodDetail } from "@/lib/data/foods";
import NutrientTable from "@/components/nutrient-table";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ fdcId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { fdcId } = await params;
  const food = await getFoodDetail(Number(fdcId));
  return {
    title: food
      ? `${food.description} | Kyokan`
      : "Food Not Found | Kyokan",
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
        <h1 className="text-2xl font-bold text-text-primary">
          {food.description}
        </h1>
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
          <div className="border border-border-default rounded-md overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-table-header-bg text-table-header-text text-sm">
                  <th className="text-right px-4 py-2 font-medium">
                    Gram Weight
                  </th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                  <th className="text-left px-4 py-2 font-medium">Unit</th>
                  <th className="text-left px-4 py-2 font-medium">Modifier</th>
                </tr>
              </thead>
              <tbody>
                {food.portions.map((p, i) => (
                  <tr
                    key={i}
                    className={`border-t border-table-border ${
                      i % 2 === 0 ? "bg-table-row-bg" : "bg-table-row-alt-bg"
                    }`}
                  >
                    <td className="px-4 py-1.5 text-sm text-text-primary text-right font-mono">
                      {p.gramWeight}g
                    </td>
                    <td className="px-4 py-1.5 text-sm text-text-primary text-right font-mono">
                      {p.amount ?? "—"}
                    </td>
                    <td className="px-4 py-1.5 text-sm text-text-secondary">
                      {p.unit ?? "—"}
                    </td>
                    <td className="px-4 py-1.5 text-sm text-text-muted">
                      {p.modifier ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
