"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { CategoryInfo } from "@/types/fdc";

interface FoodSearchFormProps {
  categories: CategoryInfo[];
}

export default function FoodSearchForm({ categories }: FoodSearchFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const params = new URLSearchParams();

      for (const [key, value] of formData.entries()) {
        const str = String(value).trim();
        if (str) params.set(key, str);
      }

      params.delete("page"); // Reset to page 1
      const qs = params.toString();
      router.push(qs ? `/foods?${qs}` : "/foods");
    },
    [router]
  );

  const selectClass =
    "px-3 py-2 bg-surface-raised border border-border-default rounded-sm text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-interactive-focus-ring";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-3">
        <input
          type="text"
          name="q"
          defaultValue={searchParams.get("q") ?? ""}
          placeholder="Search foods..."
          className="flex-1 px-3 py-2 bg-surface-raised border border-border-default rounded-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-interactive-focus-ring focus:border-interactive-primary"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-interactive-primary hover:bg-interactive-primary-hover text-interactive-primary-text rounded-sm text-sm font-medium transition-colors"
        >
          Search
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          name="categoryId"
          defaultValue={searchParams.get("categoryId") ?? ""}
          className={selectClass}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.categoryId} value={c.categoryId}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          name="state"
          defaultValue={searchParams.get("state") ?? ""}
          className={selectClass}
        >
          <option value="">Any state</option>
          <option value="raw">Raw</option>
          <option value="cooked">Cooked</option>
          <option value="unknown">Unknown</option>
        </select>

        <select
          name="preservation"
          defaultValue={searchParams.get("preservation") ?? ""}
          className={selectClass}
        >
          <option value="">Any preservation</option>
          <option value="fresh">Fresh</option>
          <option value="frozen">Frozen</option>
          <option value="canned">Canned</option>
          <option value="dried">Dried</option>
          <option value="cured">Cured</option>
          <option value="pickled">Pickled</option>
          <option value="fermented">Fermented</option>
          <option value="smoked">Smoked</option>
        </select>

        <select
          name="processing"
          defaultValue={searchParams.get("processing") ?? ""}
          className={selectClass}
        >
          <option value="">Any processing</option>
          <option value="whole">Whole</option>
          <option value="ground">Ground</option>
          <option value="sliced">Sliced</option>
          <option value="diced">Diced</option>
          <option value="shredded">Shredded</option>
          <option value="pureed">Pureed</option>
          <option value="powder">Powder</option>
          <option value="flour">Flour</option>
          <option value="juice">Juice</option>
          <option value="oil">Oil</option>
        </select>

        <select
          name="cookable"
          defaultValue={searchParams.get("cookable") ?? ""}
          className={selectClass}
        >
          <option value="">Cookability: any</option>
          <option value="true">Cookable</option>
          <option value="false">Not cookable</option>
        </select>
      </div>
    </form>
  );
}
