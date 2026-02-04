import Logo from "@/components/logo";

export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface text-text-primary">
      <header className="flex items-center gap-2 px-6 py-4">
        <Logo size={24} />
        <span className="text-base font-semibold">Kyokon</span>
      </header>
      <main>{children}</main>
    </div>
  );
}
