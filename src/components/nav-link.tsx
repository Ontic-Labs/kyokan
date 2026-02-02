"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
}

export default function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const isActive =
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`px-3 py-2 text-sm font-medium rounded-sm transition-colors ${
        isActive
          ? "bg-interactive-primary text-interactive-primary-text"
          : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
      }`}
    >
      {children}
    </Link>
  );
}
