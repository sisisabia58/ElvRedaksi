export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--sale-bg)] text-[var(--sale-ink)]">
      <div className="mx-auto w-full max-w-[760px]">{children}</div>
    </div>
  );
}
