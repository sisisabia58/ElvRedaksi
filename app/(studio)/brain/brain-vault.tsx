"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Trash2Icon } from "lucide-react";
import { createNoteAction, deleteNoteAction, saveBrainAction } from "./actions";
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
import { Textarea } from "@/components/ui/textarea";

export type BrainDocView = {
  slug: string;
  title: string;
  body: string;
  locked: boolean;
  relative: string;
};

export function BrainVault({
  docs,
  selectedSlug,
  canWrite,
}: {
  docs: BrainDocView[];
  selectedSlug: string | undefined;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const selected = docs.find((d) => d.slug === selectedSlug) ?? docs[0];
  const [body, setBody] = useState(selected?.body ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSlug, setDeleteSlug] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setBody(selected?.body ?? "");
  }, [selected?.slug, selected?.body]);

  function selectDoc(slug: string) {
    router.push(`/brain?slug=${encodeURIComponent(slug)}`);
  }

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-8rem)]">
      <aside className="md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-[var(--line)] bg-[var(--panel)] flex flex-col">
        <div className="p-4 border-b border-[var(--line)]">
          <h1 className="font-[family-name:var(--font-anton)] text-xl uppercase tracking-wide">Brain</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Panduan untuk analis dan copywriter</p>
        </div>
        <ul className="flex-1 overflow-y-auto divide-y divide-[var(--line)]">
          {docs.map((doc) => {
            const active = doc.slug === selected?.slug;
            return (
              <li key={doc.slug} className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => selectDoc(doc.slug)}
                  className={`flex-1 text-left px-4 py-3 transition-colors hover:bg-[var(--panel-2)] ${
                    active ? "bg-[var(--panel-2)] border-l-2 border-[var(--accent)]" : ""
                  }`}
                >
                  <p className="text-sm font-medium truncate">{doc.title}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">diubah {doc.relative}</p>
                </button>
                {canWrite && !doc.locked ? (
                  <button
                    type="button"
                    aria-label="Hapus catatan"
                    className="px-3 text-[var(--muted)] hover:text-destructive"
                    onClick={() => {
                      setDeleteSlug(doc.slug);
                      setDeleteError(null);
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2Icon className="size-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {canWrite ? (
          <div className="p-3 border-t border-[var(--line)]">
            <Button
              type="button"
              variant="outline"
              className="w-full border-[var(--line)]"
              onClick={() => {
                setCreateError(null);
                setCreateOpen(true);
              }}
            >
              catatan-baru
            </Button>
          </div>
        ) : null}
      </aside>

      <section className="flex-1 flex flex-col min-w-0 p-4 md:p-6 gap-4">
        {selected ? (
          <>
            <div>
              <h2 className="text-lg font-semibold">{selected.title}</h2>
              <p className="text-xs text-[var(--muted)]">diubah {selected.relative}</p>
            </div>
            <Textarea
              value={body}
              readOnly={!canWrite}
              onChange={(e) => setBody(e.target.value)}
              className="flex-1 min-h-[280px] font-mono text-sm bg-[var(--panel)] border-[var(--line)]"
            />
            {canWrite ? (
              <div className="flex flex-col items-end gap-2">
                {saveError ? (
                  <p className="text-sm text-destructive w-full" role="alert">
                    {saveError}
                  </p>
                ) : null}
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await saveBrainAction(selected.slug, body);
                      if (result.ok) {
                        setSaveError(null);
                        router.refresh();
                      } else {
                        setSaveError(result.error);
                      }
                    });
                  }}
                >
                  Simpan
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[var(--muted)]">Belum ada catatan.</p>
        )}
      </section>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateError(null);
          }
        }}
      >
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Catatan baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="note-title">Judul</Label>
            <Input
              id="note-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={80}
            />
          </div>
          {createError ? (
            <p className="text-sm text-destructive" role="alert">
              {createError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              disabled={pending || !newTitle.trim()}
              onClick={() => {
                startTransition(async () => {
                  const result = await createNoteAction(newTitle);
                  if (result.ok) {
                    setCreateOpen(false);
                    setNewTitle("");
                    setCreateError(null);
                    router.push(`/brain?slug=${encodeURIComponent(result.slug)}`);
                    router.refresh();
                  } else {
                    setCreateError(result.error);
                  }
                });
              }}
            >
              Buat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setDeleteError(null);
            setDeleteSlug(null);
          }
        }}
      >
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>Hapus catatan</DialogTitle>
            <DialogDescription>Hapus catatan ini?</DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || !deleteSlug}
              onClick={() => {
                if (!deleteSlug) return;
                startTransition(async () => {
                  const result = await deleteNoteAction(deleteSlug);
                  if (result.ok) {
                    setDeleteOpen(false);
                    setDeleteSlug(null);
                    setDeleteError(null);
                    router.push("/brain");
                    router.refresh();
                  } else {
                    setDeleteError(result.error);
                  }
                });
              }}
            >
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
