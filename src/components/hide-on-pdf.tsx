"use client";

import { usePathname } from "next/navigation";

export default function HideOnPdf({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === "/docs/pdf") return null;
  return <>{children}</>;
}
