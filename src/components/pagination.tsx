"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "next/navigation";

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
}

export default function Pagination({ total, page, pageSize }: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) return null;

  function goToPage(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  // Show a window of pages around the current page
  const windowSize = 5;
  const halfWindow = Math.floor(windowSize / 2);
  let start = Math.max(1, page - halfWindow);
  const end = Math.min(totalPages, start + windowSize - 1);
  if (end - start + 1 < windowSize) {
    start = Math.max(1, end - windowSize + 1);
  }

  const pages: number[] = [];
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-between pt-4">
      <div className="text-sm text-text-muted">
        {total.toLocaleString()} results &middot; page {page} of {totalPages}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => goToPage(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1 text-sm rounded-sm border border-border-default bg-surface-raised text-text-secondary hover:bg-surface-elevated disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Prev
        </button>
        {start > 1 && (
          <>
            <button
              onClick={() => goToPage(1)}
              className="px-3 py-1 text-sm rounded-sm border border-border-default bg-surface-raised text-text-secondary hover:bg-surface-elevated"
            >
              1
            </button>
            {start > 2 && (
              <span className="px-1 text-text-muted">&hellip;</span>
            )}
          </>
        )}
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => goToPage(p)}
            className={`px-3 py-1 text-sm rounded-sm border ${
              p === page
                ? "bg-interactive-primary text-interactive-primary-text border-interactive-primary"
                : "border-border-default bg-surface-raised text-text-secondary hover:bg-surface-elevated"
            }`}
          >
            {p}
          </button>
        ))}
        {end < totalPages && (
          <>
            {end < totalPages - 1 && (
              <span className="px-1 text-text-muted">&hellip;</span>
            )}
            <button
              onClick={() => goToPage(totalPages)}
              className="px-3 py-1 text-sm rounded-sm border border-border-default bg-surface-raised text-text-secondary hover:bg-surface-elevated"
            >
              {totalPages}
            </button>
          </>
        )}
        <button
          onClick={() => goToPage(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1 text-sm rounded-sm border border-border-default bg-surface-raised text-text-secondary hover:bg-surface-elevated disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
