"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addSourceAction,
  deleteSourceAction,
  setSourceEnabledAction,
  type SourceView,
} from "./actions";
import { Badge } from "@/components/ui/badge";
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

export function SumberPanel({ sources }: { sources: SourceView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState<"ID" | "EN">("ID");
  const [formError, setFormError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function submitAdd(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await addSourceAction({ name, url, lang });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setName("");
      setUrl("");
      router.refresh();
    });
  }

  function toggleEnabled(id: string, enabled: boolean) {
    setToggleError(null);
    startTransition(async () => {
      const result = await setSourceEnabledAction(id, enabled);
      if (!result.ok) {
        setToggleError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!deleteId) {
      return;
    }
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteSourceAction(deleteId);
      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }
      setDeleteId(null);
      router.refresh();
    });
  }

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-3xl">
      <div>
        <h1 className="font-[family-name:var(--font-anton)] text-2xl md:text-3xl uppercase tracking-wide">
          Sumber Topik
        </h1>
        <p className="text-sm text-[var(--muted)] mt-2">RSS/Atom untuk pemantau topik otomatis.</p>
      </div>

      <form onSubmit={submitAdd} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="source-name">Nama</Label>
            <Input
              id="source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-url">URL</Label>
            <Input
              id="source-url"
              type="url"
              placeholder="https://contoh.com/feed"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-lang">Bahasa</Label>
            <select
              id="source-lang"
              value={lang}
              onChange={(e) => setLang(e.target.value as "ID" | "EN")}
              className="flex h-9 w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-sm text-[var(--ink)]"
            >
              <option value="ID">Indonesia</option>
              <option value="EN">Inggris</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Jenis</Label>
            <p className="text-sm pt-2">RSS/Atom</p>
          </div>
        </div>
        {formError ? <p className="text-sm text-[var(--bad)]">{formError}</p> : null}
        {toggleError ? <p className="text-sm text-[var(--bad)]">{toggleError}</p> : null}
        <Button type="submit" disabled={pending}>
          Tambah
        </Button>
      </form>

      {sources.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Belum ada sumber. Tempel URL RSS untuk mulai.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--panel)]">
          {sources.map((source) => (
            <li key={source.id} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3 min-w-0 flex-1">
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={source.enabled}
                    aria-label={`${source.enabled ? "Matikan" : "Aktifkan"} ${source.name}`}
                    disabled={pending}
                    onClick={() => toggleEnabled(source.id, !source.enabled)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      source.enabled ? "bg-[var(--accent)]" : "bg-[var(--line)]"
                    }`}
                  >
                    <span
                      data-switch-knob
                      className={`pointer-events-none inline-block size-5 rounded-full shadow transition-transform ${
                        source.enabled
                          ? "translate-x-5 bg-[var(--bg)]"
                          : "translate-x-0 bg-[var(--ink)]"
                      }`}
                    />
                  </button>
                  <span data-switch-label className="text-xs font-medium text-[var(--ink)]">
                    {source.enabled ? "Aktif" : "Mati"}
                  </span>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium truncate">{source.name}</span>
                    <Badge variant="secondary">{source.lang}</Badge>
                  </div>
                  <p className="text-sm text-[var(--muted)] truncate">{source.url}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {source.topicCount} topik / {source.passCount7d} lolos (7 hari)
                  </p>
                  <p className="text-xs text-[var(--muted)]">{source.lastCheckedLabel}</p>
                  {source.lastError ? (
                    <p className="text-sm text-[var(--bad)]">{source.lastError}</p>
                  ) : null}
                </div>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteId(source.id);
                }}
              >
                Hapus
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus sumber?</DialogTitle>
            <DialogDescription>Sumber dan topik terkait akan dihapus.</DialogDescription>
          </DialogHeader>
          {deleteError ? <p className="text-sm text-[var(--bad)]">{deleteError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteId(null)}>
              Batal
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={confirmDelete}>
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
