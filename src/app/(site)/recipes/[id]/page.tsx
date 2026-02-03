import { notFound } from "next/navigation";
import Link from "next/link";
import { getRecipeById, getRecipeIngredients } from "@/lib/data/recipes";
import Breadcrumb from "@/components/breadcrumb";
import DataTable, { Column } from "@/components/data-table";
import DownloadJsonButton from "./download-json-button";
import CopyIdButton from "./copy-id-button";
import type { RecipeIngredientAnalysis } from "@/lib/data/recipes";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recipe = await getRecipeById(Number(id));
  if (!recipe) return { title: "Recipe Not Found" };

  return {
    title: recipe.name,
    description: recipe.description || `${recipe.name} - ${recipe.n_ingredients} ingredients, ${recipe.n_steps} steps`,
    openGraph: {
      title: `${recipe.name} | Kyokon`,
      description: recipe.description || `A ${Number(recipe.avg_rating).toFixed(1)}-star recipe with ${recipe.review_count} reviews.`,
    },
  };
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    mapped: "bg-status-success-bg text-status-success",
    needs_review: "bg-status-warning-bg text-status-warning",
    no_match: "bg-status-error-bg text-status-error",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || "bg-surface-raised text-text-muted"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function CookingMethodBadge({ method }: { method: string }) {
  return (
    <span className="px-2 py-0.5 rounded text-xs font-medium bg-status-info-bg text-status-info">
      {method}
    </span>
  );
}

const ingredientColumns: Column<RecipeIngredientAnalysis>[] = [
  {
    key: "ingredient_raw",
    header: "Ingredient",
    render: (item) => (
      <span className="text-text-primary">{item.ingredient_raw}</span>
    ),
  },
  {
    key: "canonical_slug",
    header: "Canonical",
    render: (item) =>
      item.canonical_slug ? (
        <Link
          href={`/canonicals/${item.canonical_slug}`}
          className="text-link-default hover:text-link-hover hover:underline text-sm"
        >
          {item.canonical_slug}
        </Link>
      ) : (
        <span className="text-text-muted">—</span>
      ),
  },
  {
    key: "fdc_id",
    header: "FDC",
    align: "center",
    width: "w-24",
    render: (item) =>
      item.fdc_id ? (
        <a
          href={`https://fdc.nal.usda.gov/food-details/${item.fdc_id}/nutrients`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link-default hover:text-link-hover hover:underline text-sm"
        >
          {item.fdc_id}
        </a>
      ) : (
        <span className="text-text-muted">—</span>
      ),
  },
  {
    key: "match_score",
    header: "Score",
    align: "right",
    width: "w-16",
    render: (item) => (
      <span className="text-text-secondary text-sm">
        {(item.match_score * 100).toFixed(0)}%
      </span>
    ),
  },
  {
    key: "match_status",
    header: "Status",
    align: "center",
    width: "w-28",
    render: (item) => <StatusBadge status={item.match_status} />,
  },
];

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recipeId = Number(id);

  if (isNaN(recipeId)) notFound();

  const [recipe, ingredients] = await Promise.all([
    getRecipeById(recipeId),
    getRecipeIngredients(recipeId),
  ]);

  if (!recipe) notFound();

  const mappedCount = ingredients.filter((i) => i.match_status === "mapped").length;
  const matchRate = ingredients.length > 0 ? (mappedCount / ingredients.length) * 100 : 0;

  // Collect all cooking methods
  const allMethods = new Set<string>();
  for (const ing of ingredients) {
    if (ing.cooking_methods) {
      for (const m of ing.cooking_methods) {
        allMethods.add(m);
      }
    }
  }

  return (
    <div className="space-y-8">
      <Breadcrumb
        items={[
          { label: "Recipes", href: "/recipes" },
          { label: recipe.name },
        ]}
      />

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">{recipe.name}</h1>
          <CopyIdButton id={recipe.recipe_id} />
        </div>
        
        {recipe.description && (
          <p className="text-text-secondary max-w-3xl">{recipe.description}</p>
        )}

        {/* Stats */}
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-text-muted">Rating:</span>
            <span className="text-status-warning font-medium">
              ★ {Number(recipe.avg_rating).toFixed(2)}
            </span>
            <span className="text-text-muted">({recipe.review_count} reviews)</span>
          </div>
          {recipe.minutes && (
            <div className="flex items-center gap-2">
              <span className="text-text-muted">Time:</span>
              <span className="text-text-primary">{recipe.minutes} min</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-text-muted">Ingredients:</span>
            <span className="text-text-primary">{recipe.n_ingredients}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-muted">Steps:</span>
            <span className="text-text-primary">{recipe.n_steps}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-muted">Mapped:</span>
            <span className={matchRate >= 90 ? "text-status-success" : matchRate >= 70 ? "text-status-warning" : "text-status-error"}>
              {matchRate.toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Download JSON */}
        <DownloadJsonButton
          data={{
            recipe_id: recipe.recipe_id,
            name: recipe.name,
            description: recipe.description,
            minutes: recipe.minutes,
            tags: recipe.tags,
            ingredients: recipe.ingredients,
            steps: recipe.steps,
            avg_rating: Number(recipe.avg_rating),
            review_count: recipe.review_count,
            analysis: ingredients.map((i) => ({
              ingredient_raw: i.ingredient_raw,
              canonical_slug: i.canonical_slug,
              match_status: i.match_status,
              match_score: i.match_score,
              cooking_methods: i.cooking_methods,
            })),
          }}
          filename={`recipe-${recipe.recipe_id}.json`}
        />

        {/* Tags */}
        {recipe.tags && recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {recipe.tags.slice(0, 10).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded text-xs bg-surface-raised text-text-secondary"
              >
                {tag}
              </span>
            ))}
            {recipe.tags.length > 10 && (
              <span className="text-xs text-text-muted">
                +{recipe.tags.length - 10} more
              </span>
            )}
          </div>
        )}

        {/* Cooking Methods */}
        {allMethods.size > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-text-muted">Cooking methods:</span>
            {[...allMethods].sort().map((method) => (
              <CookingMethodBadge key={method} method={method} />
            ))}
          </div>
        )}
      </div>

      {/* Ingredients Section */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Ingredients ({ingredients.length})
        </h2>
        <DataTable
          columns={ingredientColumns}
          data={ingredients}
          keyExtractor={(item, idx) => `${item.ingredient_raw}-${idx}`}
          emptyMessage="No ingredients found."
          striped
        />
      </section>

      {/* Steps Section */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">
          Instructions ({recipe.steps.length} steps)
        </h2>
        <ol className="space-y-3">
          {recipe.steps.map((step, idx) => (
            <li key={idx} className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-raised flex items-center justify-center text-sm font-medium text-text-secondary">
                {idx + 1}
              </span>
              <p className="text-text-primary pt-1">{step}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
