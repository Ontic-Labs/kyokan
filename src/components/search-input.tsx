"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef } from "react";

interface SearchInputProps {
  paramName: string;
  placeholder?: string;
  basePath: string;
}

export default function SearchInput({
  paramName,
  placeholder = "Search...",
  basePath,
}: SearchInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentValue = searchParams.get(paramName) ?? "";

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;

      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (value) {
          params.set(paramName, value);
        } else {
          params.delete(paramName);
        }
        params.delete("page"); // Reset to page 1 on search change
        const qs = params.toString();
        router.push(qs ? `${basePath}?${qs}` : basePath);
      }, 300);
    },
    [router, searchParams, paramName, basePath]
  );

  return (
    <input
      type="text"
      defaultValue={currentValue}
      onChange={handleChange}
      placeholder={placeholder}
      className="w-full px-3 py-2 bg-surface-raised border border-border-default rounded-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-interactive-focus-ring focus:border-interactive-primary"
    />
  );
}
