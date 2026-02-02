"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <h2 className="text-xl font-semibold text-text-primary">
        Something went wrong
      </h2>
      <p className="text-sm text-text-secondary max-w-md text-center">
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-interactive-primary hover:bg-interactive-primary-hover text-interactive-primary-text rounded-sm text-sm font-medium transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
