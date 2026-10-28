export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16 bg-[var(--bg)] text-[var(--ink)]">
      <main className="max-w-md space-y-4 text-center">
        <h1 className="font-[family-name:var(--font-anton)] uppercase tracking-wide text-3xl text-[var(--accent)]">
          Redaksi
        </h1>
        <p className="text-[var(--muted)] text-base leading-relaxed">
          Ruang kerja redaksi untuk menyiapkan carousel Instagram.
        </p>
      </main>
    </div>
  );
}
