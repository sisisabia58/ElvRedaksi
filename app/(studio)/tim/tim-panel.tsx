"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Role } from "@/src/auth/rbac";
import { inviteUserAction } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type TeamMemberView = {
  name: string;
  email: string;
  roleLabel: string;
  loginLabel: string;
};

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "social_media", label: "Social Media" },
  { value: "viewer", label: "Viewer" },
  { value: "kol_specialist", label: "KOL Specialist" },
];

const ACCESS_MATRIX: { role: string; line: string }[] = [
  { role: "Admin", line: "Semua akses, termasuk sumber topik, tim, dan pengaturan." },
  { role: "Social Media", line: "Review, edit, setujui, dan jadwalkan post. Edit Brain." },
  { role: "Viewer", line: "Hanya melihat." },
  { role: "KOL Specialist", line: "Hanya melihat. Ruang KOL belum dibuat." },
];

const selectClass =
  "flex h-9 w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-1 text-sm";

export function TimPanel({ members }: { members: TeamMemberView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("social_media");
  const [formError, setFormError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  function submitInvite(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await inviteUserAction({ name, email, role });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setName("");
      setEmail("");
      setRole("social_media");
      setCopied(false);
      setCopyError(null);
      setPassword(result.password);
      router.refresh();
    });
  }

  async function copyPassword() {
    if (!password) {
      return;
    }
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopied(false);
      setCopyError("Tidak bisa menyalin. Salin manual.");
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-3xl">
      <div>
        <h1 className="font-[family-name:var(--font-anton)] text-2xl md:text-3xl uppercase tracking-wide">
          Tim & Akses
        </h1>
        <p className="text-sm text-[var(--muted)] mt-2">
          Undang anggota redaksi. Login hanya lewat undangan.
        </p>
      </div>

      <form
        onSubmit={submitInvite}
        autoComplete="off"
        className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="nama">Nama</Label>
            <Input
              id="nama"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="email@contoh.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="peran">Peran</Label>
            <select
              id="peran"
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
              className={selectClass}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {formError ? (
          <p className="text-sm text-[var(--bad)]" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          Buat akun
        </Button>
      </form>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Anggota</h2>
        {members.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Belum ada anggota.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--panel)]">
            {members.map((member) => (
              <li key={member.email} className="p-4 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{member.name}</span>
                  <span className="text-sm text-[var(--muted)]">{member.roleLabel}</span>
                </div>
                <p className="text-sm text-[var(--muted)]">{member.email}</p>
                <p className="text-xs text-[var(--muted)]">{member.loginLabel}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Akses</h2>
        <ul className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
          {ACCESS_MATRIX.map((row) => (
            <li key={row.role} className="text-sm">
              <span className="font-medium">{row.role}: </span>
              <span className="text-[var(--muted)]">{row.line}</span>
            </li>
          ))}
        </ul>
      </section>

      <Dialog
        open={password !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPassword(null);
            setCopied(false);
            setCopyError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password sementara</DialogTitle>
            <DialogDescription>Tampil sekali. Salin dan kirim ke anggota tim.</DialogDescription>
          </DialogHeader>
          {password ? (
            <p className="font-mono text-lg tracking-wide break-all select-all">{password}</p>
          ) : null}
          {copied ? <p className="text-sm text-[var(--muted)]">Tersalin.</p> : null}
          {copyError ? (
            <p className="text-sm text-[var(--bad)]" role="alert">
              {copyError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={copyPassword}>
              Salin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
