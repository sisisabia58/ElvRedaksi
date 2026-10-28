"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { Slide } from "@/src/agents/copywriter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  approveDraftAction,
  deleteDraftAction,
  markPostedManuallyAction,
  postDraftNowAction,
  rejectDraftAction,
  renderAgainAction,
  retryFailedAction,
  rewriteCopyAction,
  saveAndRenderAction,
  saveCoverPhotoAction,
  saveDraftTextAction,
  saveFocalAction,
  scheduleDraftAction,
  setFormatAction,
  setTemplateAction,
} from "../actions";

type DraftView = {
  id: string;
  topicId: string;
  status: string;
  format: "carousel_full" | "teaser_bio";
  template: "stabilo" | "foto_penuh" | "serif" | "catatan";
  slides: Slide[];
  caption: string;
  hashtags: string[];
  altHeadlines: [string, string];
  focalY: number;
  shortCode: string;
  clickCount: number;
  textDirty: boolean;
  sensitive: boolean;
  score: number | null;
  sourceName: string;
  handle: string;
  slideCount: number;
  usePublicMedia: boolean;
  assetIds: string[];
};

const TEMPLATES: { value: DraftView["template"]; label: string }[] = [
  { value: "stabilo", label: "Stabilo" },
  { value: "foto_penuh", label: "Foto penuh" },
  { value: "serif", label: "Serif" },
  { value: "catatan", label: "Catatan" },
];

const FORMATS: { value: DraftView["format"]; label: string }[] = [
  { value: "carousel_full", label: "Carousel penuh" },
  { value: "teaser_bio", label: "Teaser + link bio" },
];

function previewSlideSrc(draft: DraftView, index: number): string {
  if (draft.usePublicMedia && draft.assetIds[index]) {
    return `/media/${draft.assetIds[index]}`;
  }
  return `/review/${draft.id}/slide/${index}`;
}

function downloadSlideSrc(draft: DraftView, index: number): string {
  return `/review/${draft.id}/slide/${index}`;
}

function coverSlide(slides: Slide[]): Slide {
  return slides.find((s) => s.role === "cover") ?? slides[0] ?? { role: "cover", kicker: "", headline: "", body: "" };
}

export function EditorPanel({
  draft,
  canPublish,
  canWrite,
}: {
  draft: DraftView;
  canPublish: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [previewTab, setPreviewTab] = useState<"render" | "focal">("render");
  const [slideIndex, setSlideIndex] = useState(0);
  const [slides, setSlides] = useState(draft.slides);
  const [kicker, setKicker] = useState(coverSlide(draft.slides).kicker);
  const [headline, setHeadline] = useState(coverSlide(draft.slides).headline);
  const [body, setBody] = useState(coverSlide(draft.slides).body);
  const [caption, setCaption] = useState(draft.caption);
  const [hashtagsText, setHashtagsText] = useState(draft.hashtags.join(", "));
  const [altHeadlines, setAltHeadlines] = useState(draft.altHeadlines);
  const [format, setFormat] = useState(draft.format);
  const [template, setTemplate] = useState(draft.template);
  const [focalY, setFocalY] = useState(draft.focalY);
  const [scheduleAt, setScheduleAt] = useState("");
  const [copyLabel, setCopyLabel] = useState("Copy caption + hashtag");
  const [error, setError] = useState<string | null>(null);

  const slideTotal = draft.slideCount;
  const clampedIndex = Math.min(slideIndex, Math.max(slideTotal - 1, 0));

  const savePayload = useMemo(() => {
    const hashtags = hashtagsText
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);
    const updatedSlides = slides.map((slide) => {
      if (slide.role !== "cover") {
        return slide;
      }
      return { ...slide, kicker, headline, body };
    });
    return {
      slides: updatedSlides,
      caption,
      hashtags,
      altHeadlines,
      kicker,
    };
  }, [slides, kicker, headline, body, caption, hashtagsText, altHeadlines]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, redirect?: string) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Terjadi kesalahan");
        return;
      }
      if (redirect) {
        router.push(redirect);
        return;
      }
      router.refresh();
    });
  }

  async function onPhotoFile(file: File) {
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setError("Hanya PNG atau JPEG");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Maksimal 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        return;
      }
      run(() => saveCoverPhotoAction(draft.id, dataUrl));
    };
    reader.readAsDataURL(file);
  }

  function copyCaption() {
    const tags = savePayload.hashtags.map((h) => `#${h}`).join(" ");
    const text = `${caption}\n\n${tags}`;
    void navigator.clipboard.writeText(text);
    setCopyLabel("Tersalin");
    window.setTimeout(() => setCopyLabel("Copy caption + hashtag"), 1600);
  }

  const savedCoverHeadline = coverSlide(draft.slides).headline;

  const hasUnsavedTextEdits = useMemo(() => {
    const hashtags = hashtagsText
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);
    const hashtagsMatch =
      hashtags.length === draft.hashtags.length &&
      hashtags.every((tag, i) => tag === draft.hashtags[i]);
    return headline !== savedCoverHeadline || caption !== draft.caption || !hashtagsMatch;
  }, [headline, caption, hashtagsText, draft.caption, draft.hashtags, savedCoverHeadline]);

  function commitFocalFromInput(input: HTMLInputElement) {
    const value = Number(input.value);
    setFocalY(value);
    run(() => saveFocalAction(draft.id, value));
  }

  const publishBlocked = draft.textDirty || hasUnsavedTextEdits;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <Link href="/review" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        ← Antrian review
      </Link>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {draft.sensitive ? (
        <p className="text-sm text-amber-200">Topik sensitif — cek risiko sebelum publish.</p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={previewTab === "render" ? "default" : "outline"}
              onClick={() => setPreviewTab("render")}
            >
              Hasil render
            </Button>
            <Button
              type="button"
              size="sm"
              variant={previewTab === "focal" ? "default" : "outline"}
              onClick={() => setPreviewTab("focal")}
            >
              Atur posisi foto
            </Button>
          </div>

          {previewTab === "render" ? (
            <div className="space-y-3">
              <div className="aspect-[4/5] bg-[var(--panel-2)] rounded-lg overflow-hidden border border-[var(--line)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewSlideSrc(draft, clampedIndex)} alt="" className="size-full object-cover" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={clampedIndex <= 0}
                  onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
                >
                  ←
                </Button>
                <span className="text-sm text-[var(--muted)]">
                  {clampedIndex + 1}/{slideTotal}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={clampedIndex >= slideTotal - 1}
                  onClick={() => setSlideIndex((i) => Math.min(slideTotal - 1, i + 1))}
                >
                  →
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
              <label className="block text-sm">
                Posisi vertikal ({focalY})
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={focalY}
                  disabled={!canWrite || pending}
                  className="mt-2 w-full"
                  onChange={(e) => setFocalY(Number(e.target.value))}
                  onMouseUp={(e) => commitFocalFromInput(e.currentTarget)}
                  onTouchEnd={(e) => commitFocalFromInput(e.currentTarget)}
                  onKeyUp={(e) => commitFocalFromInput(e.currentTarget)}
                />
              </label>
              {canWrite ? (
                <label className="block text-sm">
                  Ganti gambar
                  <Input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="mt-2 border-[var(--line)]"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void onPhotoFile(file);
                      }
                    }}
                  />
                </label>
              ) : null}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="text-sm space-y-1">
            <p>
              Status: <span className="font-mono">{draft.status}</span>
              {draft.score != null ? (
                <span className="ml-2 text-[var(--accent)]">Skor {draft.score}</span>
              ) : null}
            </p>
            <p>
              /s/{draft.shortCode} · {draft.clickCount} klik
            </p>
          </div>

          {publishBlocked ? (
            <p className="text-sm text-amber-200">Render dulu teks yang baru</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {canPublish ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || publishBlocked}
                  onClick={() => run(() => postDraftNowAction(draft.id))}
                >
                  Posting sekarang
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending || publishBlocked}
                  onClick={() => run(() => approveDraftAction(draft.id))}
                >
                  Setujui
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending || publishBlocked}
                  onClick={() => run(() => markPostedManuallyAction(draft.id))}
                >
                  Sudah diposting manual
                </Button>
              </>
            ) : null}
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => rejectDraftAction(draft.id))}
              >
                Tolak
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => run(() => deleteDraftAction(draft.id), "/review")}
              >
                Hapus
              </Button>
            ) : null}
            {canPublish && draft.status === "failed" ? (
              <Button
                type="button"
                size="sm"
                disabled={pending || publishBlocked}
                onClick={() => run(() => retryFailedAction(draft.id))}
              >
                Coba lagi
              </Button>
            ) : null}
          </div>

          {canPublish ? (
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-[var(--muted)] uppercase">
                JADWAL POSTING (WIB)
              </p>
              <Input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="border-[var(--line)] bg-[var(--panel-2)]"
              />
              <Button
                type="button"
                size="sm"
                disabled={pending || publishBlocked || !scheduleAt}
                onClick={() =>
                  run(() => scheduleDraftAction(draft.id, `${scheduleAt}+07:00`))
                }
              >
                Jadwalkan
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Template</p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={template === opt.value ? "default" : "outline"}
                  disabled={!canWrite || pending}
                  onClick={() => {
                    setTemplate(opt.value);
                    run(() => setTemplateAction(draft.id, opt.value));
                  }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Format</p>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={format === opt.value ? "default" : "outline"}
                  disabled={!canWrite || pending}
                  onClick={() => {
                    setFormat(opt.value);
                    run(() => setFormatAction(draft.id, opt.value));
                  }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            {format === "teaser_bio" ? (
              <p className="text-xs text-[var(--muted)]">
                Slide isi di bawah tetap disimpan, tapi yang diposting cuma cover + slide baca di link bio.
              </p>
            ) : null}
          </div>

          {canWrite ? (
            <div className="space-y-3">
              <Input
                value={kicker}
                onChange={(e) => setKicker(e.target.value)}
                placeholder="Kicker"
                className="border-[var(--line)]"
              />
              <Input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Headline"
                className="border-[var(--line)]"
              />
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Isi cover"
                className="border-[var(--line)] min-h-[80px]"
              />
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Caption"
                className="border-[var(--line)] min-h-[80px]"
              />
              <Input
                value={hashtagsText}
                onChange={(e) => setHashtagsText(e.target.value)}
                placeholder="hashtag1, hashtag2"
                className="border-[var(--line)]"
              />
              <div className="flex flex-wrap gap-2">
                {altHeadlines.map((alt, i) => (
                  <Button
                    key={i}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setHeadline(alt)}
                  >
                    {alt}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => saveAndRenderAction(draft.id, savePayload))}
                >
                  Simpan & render ulang
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => run(() => saveDraftTextAction(draft.id, savePayload))}
                >
                  Simpan teks saja
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => rewriteCopyAction(draft.topicId))}
                >
                  Tulis ulang
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-4 border-t border-[var(--line)]">
            <Button type="button" variant="outline" size="sm" onClick={copyCaption}>
              {copyLabel}
            </Button>
            {canWrite ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => run(() => renderAgainAction(draft.id))}
              >
                Render ulang
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                for (let i = 0; i < slideTotal; i++) {
                  const a = document.createElement("a");
                  a.href = downloadSlideSrc(draft, i);
                  a.download = `slide-${i + 1}.png`;
                  a.click();
                }
              }}
            >
              Download semua
            </Button>
            {Array.from({ length: slideTotal }, (_, i) => (
              <a
                key={i}
                href={downloadSlideSrc(draft, i)}
                download={`slide-${i + 1}.png`}
                className="text-xs underline text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Unduh {i + 1}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
