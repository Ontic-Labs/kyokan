import Link from "next/link";
import NavLink from "@/components/nav-link";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b border-border-default bg-surface-nav sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <Link
              href="/"
              className="text-lg font-semibold text-text-primary tracking-tight"
            >
              Kyokan
            </Link>
            <div className="flex items-center gap-1">
              <NavLink href="/foods">Foods</NavLink>
              <NavLink href="/categories">Categories</NavLink>
              <NavLink href="/nutrients">Nutrients</NavLink>
              <NavLink href="/docs">API Docs</NavLink>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {children}
      </main>

      <footer className="border-t border-border-default py-6 text-center text-sm text-text-muted">
        Kyokan &mdash; USDA FoodData Central Explorer
      </footer>
    </div>
  );
}
