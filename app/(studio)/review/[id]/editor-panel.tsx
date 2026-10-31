"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import type { Slide } from "@/src/agents/copywriter";
import {
  draftStatusLabel,
  reviewActionVisible,
  reviewDeleteConfirm,
  reviewDeleteLabel,
  SCHEDULE_MISSING_MESSAGE,
  type DraftStatus,
} from "@/src/domain/status";
import { slidesForFormat } from "@/src/render/pick";
import { coverUploadRejectionMessage, omitRejectedCoverPhoto } from "@/src/studio/cover-photo";
import {
  adoptServerDraft,
  clampedFocal,
  draftAwaitsRewrite,
  editorPublishBlocked,
  editorTextFields,
  focalSliderIsUnsaved,
  readPreviewFields,
  switchPreviewFormat,
  writePreviewFields,
} from "@/src/studio/editor-sync";
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
  status: DraftStatus;
  format: "carousel_full" | "teaser_bio";
  template: "stabilo" | "foto_penuh" | "serif" | "catatan" | "berita_pro";
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
  postedAt: string | null;
  permalink: string | null;
  topicUrl: string | null;
  slideCount: number;
  usePublicMedia: boolean;
  assetIds: string[];
  updatedAt: string;
};

const TEMPLATES: { value: DraftView["template"]; label: string }[] = [
  { value: "berita_pro", label: "Berita Pro" },
  { value: "stabilo", label: "Stabilo" },
  { value: "foto_penuh", label: "Foto penuh" },
  { value: "serif", label: "Serif" },
  { value: "catatan", label: "Catatan" },
];

const FORMATS: { value: DraftView["format"]; label: string; detail: string }[] = [
  { value: "carousel_full", label: "Carousel penuh", detail: "Cover + semua slide isi" },
  { value: "teaser_bio", label: "Teaser + link bio", detail: 'Cover + slide "baca di link bio"' },
];

function slideRoleLabel(role: string): string {
  if (role === "cover") return "Cover";
  if (role === "cta") return "Ajakan";
  return "Poin";
}

function formatPostedAt(iso: string): string {
  const formatted = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  return `${formatted} WIB`;
}

function sourceHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function FieldLabel({ children }: { children: string }) {
  return (
    <p data-review-label className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
      {children}
    </p>
  );
}

function StudioCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-studio-card className="space-y-3 rounded-xl border border-[var(--rule)] bg-[var(--panel-2)] p-4">
      <h2 data-review-label className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function previewSlideSrc(draft: DraftView, index: number): string {
  if (draft.usePublicMedia && draft.assetIds[index]) {
    return `/media/${draft.assetIds[index]}`;
  }
  const version = draft.assetIds[index] ?? draft.updatedAt;
  return `/review/${draft.id}/slide/${index}?v=${encodeURIComponent(version)}`;
}

function downloadSlideSrc(draft: DraftView, index: number): string {
  return `/review/${draft.id}/slide/${index}`;
}

export function EditorPanel({
  draft,
  canPublish,
  canWrite,
  modeBanner,
  blockPublish,
}: {
  draft: DraftView;
  canPublish: boolean;
  canWrite: boolean;
  modeBanner: string;
  blockPublish: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!draft.textDirty) {
      return;
    }
    const timer = window.setInterval(() => {
      router.refresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [draft.textDirty, draft.id, router]);
  const [previewTab, setPreviewTab] = useState<"render" | "focal">("render");
  const [slideIndex, setSlideIndex] = useState(0);
  const initialFields = editorTextFields(draft, 0);
  const [slides, setSlides] = useState(draft.slides);
  const [kicker, setKicker] = useState(initialFields.kicker);
  const [headline, setHeadline] = useState(initialFields.headline);
  const [body, setBody] = useState(initialFields.body);
  const [caption, setCaption] = useState(draft.caption);
  const [hashtagsText, setHashtagsText] = useState(draft.hashtags.join(", "));
  const [altHeadlines, setAltHeadlines] = useState(draft.altHeadlines);
  const [format, setFormat] = useState(draft.format);
  const [template, setTemplate] = useState(draft.template);
  const [focalY, setFocalY] = useState(draft.focalY);
  const [scheduleAt, setScheduleAt] = useState("");
  const [copyLabel, setCopyLabel] = useState("Copy caption + hashtag");
  const [error, setError] = useState<string | null>(null);
  const [blockedPhotoUrl, setBlockedPhotoUrl] = useState<string | null>(null);
  const [serverBaseline, setServerBaseline] = useState(() => editorTextFields(draft, 0));
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(draft.updatedAt);
  const slideTotal = draft.slideCount;
  const clampedIndex = Math.min(slideIndex, Math.max(slideTotal - 1, 0));
  const slideOptions = useMemo(
    () => ({ template, slideCount: draft.slideCount }),
    [template, draft.slideCount],
  );
  if (draft.updatedAt !== seenUpdatedAt) {
    const next = editorTextFields(draft, clampedIndex);
    const adopted = adoptServerDraft(
      serverBaseline,
      { slides, kicker, headline, body, caption, hashtagsText, altHeadlines },
      next,
      { format, index: clampedIndex, template, slideCount: draft.slideCount },
    );
    setSlides(adopted.slides);
    setKicker(adopted.kicker);
    setHeadline(adopted.headline);
    setBody(adopted.body);
    setCaption(adopted.caption);
    setHashtagsText(adopted.hashtagsText);
    setAltHeadlines(adopted.altHeadlines);
    setServerBaseline(next);
    setSeenUpdatedAt(draft.updatedAt);
  }

  const savePayload = useMemo(() => {
    const hashtags = hashtagsText
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);
    const updatedSlides = writePreviewFields(
      format,
      omitRejectedCoverPhoto(slides, blockedPhotoUrl),
      clampedIndex,
      { kicker, headline, body },
      slideOptions,
    );
    const cover = updatedSlides.find((slide) => slide.role === "cover") ?? updatedSlides[0];
    return {
      slides: updatedSlides,
      caption,
      hashtags,
      altHeadlines,
      kicker: cover?.kicker ?? "",
    };
  }, [
    slides,
    kicker,
    headline,
    body,
    caption,
    hashtagsText,
    altHeadlines,
    blockedPhotoUrl,
    format,
    clampedIndex,
    slideOptions,
  ]);

  const previewSlides = useMemo(() => {
    try {
      return slidesForFormat(format, savePayload.slides, slideOptions);
    } catch {
      return savePayload.slides;
    }
  }, [format, savePayload.slides, slideOptions]);

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
        setError("Format gambar tidak valid");
        return;
      }
      setError(null);
      startTransition(async () => {
        try {
          const result = await saveCoverPhotoAction(draft.id, dataUrl);
          if (!result.ok) {
            setBlockedPhotoUrl(dataUrl);
            setSlides((prev) => omitRejectedCoverPhoto(prev, dataUrl));
            setError(result.error ?? "Gagal mengunggah gambar");
            return;
          }
          setBlockedPhotoUrl(null);
          setSlides((prev) =>
            prev.map((slide) =>
              slide.role === "cover"
                ? ({ ...slide, photoDataUrl: dataUrl } as Slide & { photoDataUrl?: string })
                : slide,
            ),
          );
          router.refresh();
        } catch (uploadError) {
          setBlockedPhotoUrl(dataUrl);
          setSlides((prev) => omitRejectedCoverPhoto(prev, dataUrl));
          setError(coverUploadRejectionMessage(uploadError));
        }
      });
    };
    reader.onerror = () => {
      setError("Gagal mengunggah gambar");
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

  const hasUnsavedTextEdits = useMemo(() => {
    const hashtags = hashtagsText
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);
    const hashtagsMatch =
      hashtags.length === draft.hashtags.length &&
      hashtags.every((tag, i) => tag === draft.hashtags[i]);
    const edited = writePreviewFields(format, slides, clampedIndex, { kicker, headline, body }, slideOptions);
    const textChanged =
      edited.length !== draft.slides.length ||
      edited.some((slide, index) => {
        const saved = draft.slides[index];
        return (
          !saved ||
          slide.kicker !== saved.kicker ||
          slide.headline !== saved.headline ||
          slide.body !== saved.body
        );
      });
    return textChanged || caption !== draft.caption || !hashtagsMatch;
  }, [
    headline,
    kicker,
    body,
    caption,
    hashtagsText,
    slides,
    clampedIndex,
    draft.caption,
    draft.hashtags,
    draft.slides,
    format,
    slideOptions,
  ]);

  function showPreview(nextIndex: number) {
    const written = writePreviewFields(format, slides, clampedIndex, { kicker, headline, body }, slideOptions);
    const bounded = Math.min(Math.max(nextIndex, 0), Math.max(slideTotal - 1, 0));
    const text = readPreviewFields(format, written, bounded, slideOptions);
    setSlides(written);
    setKicker(text.kicker);
    setHeadline(text.headline);
    setBody(text.body);
    setSlideIndex(bounded);
  }

  const posting = draft.status === "posting";
  const frozen = posting || draft.status === "posted" || draft.status === "simulasi";
  const published = draft.status === "posted" || draft.status === "simulasi";
  const href = sourceHref(draft.topicUrl);
  const fieldsLocked = frozen || !canWrite;
  const showApprove = canPublish && reviewActionVisible(draft.status, "approve");
  const showSchedule = canPublish && reviewActionVisible(draft.status, "schedule");
  const showReject = canWrite && reviewActionVisible(draft.status, "reject");
  const showPostNow = canPublish && reviewActionVisible(draft.status, "post_now");
  const showManual = canPublish && reviewActionVisible(draft.status, "posted_manual");
  const showRetry = canPublish && reviewActionVisible(draft.status, "retry");
  const showDelete = canWrite && reviewActionVisible(draft.status, "delete");

  function commitFocalFromInput(input: HTMLInputElement) {
    const value = clampedFocal(Number(input.value));
    setFocalY(value);
    if (!focalSliderIsUnsaved(draft.focalY, value)) {
      return;
    }
    run(() => saveFocalAction(draft.id, value));
  }

  const awaitsRewrite = draftAwaitsRewrite(draft.slides);
  const publishBlocked = editorPublishBlocked({
    textDirty: draft.textDirty,
    hasUnsavedTextEdits,
    savedFocal: draft.focalY,
    sliderFocal: focalY,
    awaitingRewrite: awaitsRewrite,
  });

  function downloadAll() {
    for (let i = 0; i < slideTotal; i++) {
      const a = document.createElement("a");
      a.href = downloadSlideSrc(draft, i);
      a.download = `slide-${i + 1}.png`;
      a.click();
    }
  }

  function downloadOne(index: number) {
    const a = document.createElement("a");
    a.href = downloadSlideSrc(draft, index);
    a.download = `slide-${index + 1}.png`;
    a.click();
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <Link href="/review" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        ← Antrian review
      </Link>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {draft.sensitive ? (
        <p className="text-sm text-amber-200">Topik sensitif — cek risiko sebelum publish.</p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <div data-preview-column className="space-y-4">
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
              <div
                data-cover-preview
                className="aspect-[4/5] w-full overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewSlideSrc(draft, clampedIndex)} alt="" className="size-full object-contain" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={clampedIndex <= 0}
                  onClick={() => showPreview(clampedIndex - 1)}
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
                  onClick={() => showPreview(clampedIndex + 1)}
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
                  disabled={fieldsLocked || pending}
                  className="mt-2 w-full"
                  onChange={(e) => setFocalY(Number(e.target.value))}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerUp={(e) => commitFocalFromInput(e.currentTarget)}
                  onLostPointerCapture={(e) => commitFocalFromInput(e.currentTarget)}
                  onBlur={(e) => commitFocalFromInput(e.currentTarget)}
                />
              </label>
              {canWrite && !frozen ? (
                <label className="block text-sm">
                  Ganti gambar
                  <Input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="mt-2 border-[var(--line)]"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
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

        <div className={`space-y-4 ${canWrite && !frozen ? "pb-24" : ""}`}>
          <StudioCard title={`STATUS: ${draftStatusLabel(draft.status).toUpperCase()}`}>
            <p className={blockPublish ? "text-sm text-amber-100" : "text-sm text-[var(--muted)]"}>{modeBanner}</p>
            {published ? (
              <div className="space-y-1 rounded-lg border border-[var(--accent)] px-3 py-2">
                <p className="text-sm font-semibold text-[var(--accent)]">{draftStatusLabel(draft.status)}</p>
                {draft.status === "simulasi" ? (
                  <p className="text-sm text-[var(--muted)]">Simulasi. Tidak terkirim ke Instagram.</p>
                ) : null}
                {draft.postedAt ? <p className="text-sm text-[var(--ink)]">{formatPostedAt(draft.postedAt)}</p> : null}
                {draft.status === "posted" && draft.permalink ? (
                  <a
                    href={draft.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-[var(--ink)] underline"
                  >
                    Buka di Instagram
                  </a>
                ) : null}
                <p className="text-sm text-[var(--ink)]">/s/{draft.shortCode}</p>
              </div>
            ) : null}
            <p className="text-sm text-[var(--ink)]">
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="underline">
                  {draft.sourceName}
                </a>
              ) : (
                draft.sourceName
              )}
              {" · "}
              {draft.clickCount} klik
              {draft.score != null ? (
                <span className="ml-2 text-[var(--accent)]">Skor {draft.score}</span>
              ) : null}
            </p>
            {posting ? <p className="text-sm text-amber-200">Draf sedang diposting</p> : null}

          {awaitsRewrite ? (
            <p className="text-sm text-amber-200">Menunggu tulis ulang. Jangan setujui naskah demo.</p>
          ) : null}
          {publishBlocked && !awaitsRewrite ? (
            <p className="text-sm text-amber-200">Render dulu teks yang baru</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {showPostNow ? (
              <Button
                type="button"
                size="sm"
                disabled={pending || publishBlocked || blockPublish}
                onClick={() => run(() => postDraftNowAction(draft.id))}
              >
                Posting sekarang
              </Button>
            ) : null}
            {showApprove ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || publishBlocked}
                onClick={() => run(() => approveDraftAction(draft.id))}
              >
                Setujui
              </Button>
            ) : null}
            {showRetry ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || publishBlocked || blockPublish}
                onClick={() => run(() => retryFailedAction(draft.id))}
              >
                Coba lagi
              </Button>
            ) : null}
          </div>

          {showSchedule ? (
            <div className="space-y-2">
              <FieldLabel>Jadwal posting (WIB)</FieldLabel>
              <Input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="border-[var(--rule)] bg-[var(--bg)] text-[var(--ink)]"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || publishBlocked || blockPublish}
                onClick={() => {
                  if (!scheduleAt) {
                    setError(SCHEDULE_MISSING_MESSAGE);
                    return;
                  }
                  run(() => scheduleDraftAction(draft.id, `${scheduleAt}+07:00`));
                }}
              >
                Jadwalkan
              </Button>
            </div>
          ) : null}

          {showManual || showReject || showDelete ? (
            <div className="flex flex-wrap gap-2">
              {showManual ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending || publishBlocked}
                  onClick={() => run(() => markPostedManuallyAction(draft.id))}
                >
                  Sudah diposting manual
                </Button>
              ) : null}
              {showReject ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => run(() => rejectDraftAction(draft.id))}
                >
                  Tolak
                </Button>
              ) : null}
              {showDelete ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => {
                    const confirm = reviewDeleteConfirm(draft.status);
                    if (confirm && !window.confirm(confirm)) return;
                    run(() => deleteDraftAction(draft.id), "/review");
                  }}
                >
                  {reviewDeleteLabel(draft.status)}
                </Button>
              ) : null}
            </div>
          ) : null}
          </StudioCard>

          {previewSlides.map((slide, index) => {
            const active = index === clampedIndex;
            return (
              <StudioCard key={`${slide.role}-${index}`} title={`Slide ${index + 1} · ${slideRoleLabel(slide.role)}`}>
                {slide.role === "cover" ? (
                  <>
                    <FieldLabel>Template</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {TEMPLATES.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={fieldsLocked || pending}
                          className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-100 ${
                            template === opt.value
                              ? "border-[var(--accent)] text-[var(--accent)]"
                              : "border-[var(--rule)] bg-[var(--bg)] text-[var(--ink)]"
                          }`}
                          onClick={() => {
                            if (fieldsLocked) return;
                            setTemplate(opt.value);
                            run(() => setTemplateAction(draft.id, opt.value));
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <FieldLabel>Format post</FieldLabel>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {FORMATS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={fieldsLocked || pending}
                          className={`rounded-xl border p-3 text-left disabled:opacity-100 ${
                            format === opt.value
                              ? "border-[var(--accent)] text-[var(--ink)]"
                              : "border-[var(--rule)] bg-[var(--bg)] text-[var(--ink)]"
                          }`}
                          onClick={() => {
                            if (fieldsLocked) return;
                            if (opt.value !== format) {
                              const nextPreview = switchPreviewFormat({
                                slides,
                                fromFormat: format,
                                toFormat: opt.value,
                                previewIndex: clampedIndex,
                                kicker,
                                headline,
                                body,
                              });
                              setSlides(nextPreview.slides);
                              setKicker(nextPreview.kicker);
                              setHeadline(nextPreview.headline);
                              setBody(nextPreview.body);
                              setSlideIndex(nextPreview.index);
                            }
                            setFormat(opt.value);
                            run(() => setFormatAction(draft.id, opt.value));
                          }}
                        >
                          <span className="block text-sm font-medium">{opt.label}</span>
                          <span data-format-detail className="mt-1 block text-[13px] text-[var(--muted)]">
                            {opt.detail}
                          </span>
                        </button>
                      ))}
                    </div>
                    {format === "teaser_bio" ? (
                      <p className="text-xs text-[var(--muted)]">
                        Slide isi di bawah tetap disimpan, tapi yang diposting cuma cover + slide baca di link bio.
                      </p>
                    ) : null}
                  </>
                ) : null}
                {active ? (
                  <>
                    <FieldLabel>Kicker</FieldLabel>
                    <Input
                      value={kicker}
                      onChange={(e) => setKicker(e.target.value)}
                      disabled={fieldsLocked}
                      className="border-[var(--rule)] bg-[var(--bg)] text-[var(--ink)]"
                    />
                    <FieldLabel>Headline di gambar</FieldLabel>
                    <Textarea
                      value={headline}
                      onChange={(e) => setHeadline(e.target.value)}
                      disabled={fieldsLocked}
                      className="min-h-[80px] border-[var(--rule)] bg-[var(--bg)] text-[var(--ink)]"
                    />
                    {slide.role === "cover" ? (
                      <div className="space-y-2">
                        <FieldLabel>Alternatif</FieldLabel>
                        <div className="flex flex-wrap gap-2">
                          {altHeadlines.map((alt, altIndex) => (
                            <Button
                              key={altIndex}
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={fieldsLocked}
                              onClick={() => setHeadline(alt)}
                            >
                              {alt}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <FieldLabel>Isi</FieldLabel>
                    <Textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      disabled={fieldsLocked}
                      className="min-h-[80px] border-[var(--rule)] bg-[var(--bg)] text-[var(--ink)]"
                    />
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-[var(--ink)]">{slide.kicker}</p>
                    <p className="text-sm font-medium text-[var(--ink)]">{slide.headline}</p>
                    <p data-slide-copy className="text-sm text-[var(--muted)]">
                      {slide.body}
                    </p>
                    {!fieldsLocked ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => showPreview(index)}>
                        Ubah slide ini
                      </Button>
                    ) : null}
                  </div>
                )}
              </StudioCard>
            );
          })}

          <StudioCard title="Caption">
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={fieldsLocked}
              className="min-h-[80px] border-[var(--rule)] bg-[var(--bg)] text-[var(--ink)]"
            />
          </StudioCard>

          <StudioCard title="Hashtag">
            <Input
              value={hashtagsText}
              onChange={(e) => setHashtagsText(e.target.value)}
              disabled={fieldsLocked}
              className="border-[var(--rule)] bg-[var(--bg)] text-[var(--ink)]"
            />
          </StudioCard>

          <StudioCard title="Unduh">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={downloadAll}>
                Download semua ({slideTotal})
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => downloadOne(clampedIndex)}>
                Slide {clampedIndex + 1}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={copyCaption}>
                {copyLabel}
              </Button>
              {canWrite && !frozen ? (
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
            </div>
          </StudioCard>

          {canWrite && !frozen ? (
            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 md:left-[240px]">
              <div className="grid gap-8 px-6 md:px-8 lg:grid-cols-2">
                <div className="hidden lg:block" aria-hidden />
                <div data-save-bar className="pointer-events-auto border-t border-[var(--rule)] bg-[var(--bg)] py-3">
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
                      variant="outline"
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
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
