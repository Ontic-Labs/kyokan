import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <h2 className="text-xl font-semibold text-text-primary">Not Found</h2>
      <p className="text-sm text-text-secondary">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="px-4 py-2 bg-interactive-primary hover:bg-interactive-primary-hover text-interactive-primary-text rounded-sm text-sm font-medium transition-colors"
      >
        Go home
      </Link>
    </div>
  );
}
