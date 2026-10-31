import type { Metadata } from "next";
import { login } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const gridStyle = {
  backgroundColor: "var(--bg)",
  backgroundImage:
    "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
  backgroundSize: "32px 32px",
  colorScheme: "dark" as const,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const showError = params.error === "1";

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12 text-[var(--ink)]"
      style={gridStyle}
    >
      <div className="w-full max-w-sm rounded-xl border border-[var(--line)] bg-[var(--panel)] p-8 shadow-lg space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-xs font-medium tracking-[0.2em] text-[var(--muted)] uppercase">REDAKSI</p>
          <h1 className="font-[family-name:var(--font-anton)] text-3xl uppercase tracking-wide">Studio</h1>
          <p className="text-sm text-[var(--muted)]">Khusus tim. Akun dibuat oleh admin.</p>
        </div>
        <form action={login} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="bg-[var(--panel-2)]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="bg-[var(--panel-2)]"
            />
          </div>
          {showError ? (
            <p className="text-sm text-[var(--bad)]" role="alert">
              Email atau password salah.
            </p>
          ) : null}
          <Button type="submit" className="w-full bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--accent)]/90">
            Masuk ke HQ
          </Button>
        </form>
      </div>
    </div>
  );
}
