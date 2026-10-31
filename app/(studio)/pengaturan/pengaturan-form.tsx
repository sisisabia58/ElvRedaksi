"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { isLocalPublicUrl } from "@/src/domain/public-url";
import type { Settings, SettingsInput } from "@/src/studio/settings";
import {
  changePasswordAction,
  disconnectInstagramAction,
  queueBeritaProRerenderAction,
  restoreLogoAction,
  saveInstagramConnectAction,
  saveLogoAction,
  saveSettingsAction,
  setPracticeModeAction,
} from "./actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RegenerateDemoButton } from "@/components/studio/regenerate-demo-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fieldClass =
  "h-8 w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 text-sm text-[var(--ink)]";

function brandFromSettings(settings: Settings): SettingsInput {
  return {
    name: settings.name,
    handle: settings.handle,
    initial: settings.initial,
    accent: settings.accent,
    kicker: settings.kicker,
    workStart: settings.workStart,
    workEnd: settings.workEnd,
    passThreshold: settings.passThreshold,
    defaultFormat: settings.defaultFormat,
    defaultTemplate: settings.defaultTemplate,
    slideCount: settings.slideCount,
    publicBaseUrl: settings.publicBaseUrl,
  };
}

export function PengaturanForm({
  settings,
  llmBanner,
  geminiPause,
  demoReviewCount,
  regenerateProgress,
}: {
  settings: Settings;
  llmBanner: string | null;
  geminiPause?: string | null;
  demoReviewCount: number;
  regenerateProgress: { done: number; total: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [brandError, setBrandError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoNote, setLogoNote] = useState<string | null>(null);
  const [rerenderNote, setRerenderNote] = useState<string | null>(null);
  const [igError, setIgError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [brand, setBrand] = useState<SettingsInput>(() => brandFromSettings(settings));
  const [igUserId, setIgUserId] = useState(settings.igUserId ?? "");
  const [igToken, setIgToken] = useState("");
  const [confirmLive, setConfirmLive] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const account = settings.igUsername?.trim().replace(/^@/, "") ?? "";

  function onBrandSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveSettingsAction(brand);
      if (result.ok) {
        setBrandError(null);
        router.refresh();
      } else {
        setBrandError(result.error);
      }
    });
  }

  function onPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await changePasswordAction(
        passwordForm.current,
        passwordForm.next,
        passwordForm.confirm,
      );
      if (result.ok) {
        setPasswordError(null);
        setPasswordSaved(true);
        setPasswordForm({ current: "", next: "", confirm: "" });
      } else {
        setPasswordSaved(false);
        setPasswordError(result.error);
      }
    });
  }

  function onIgConnectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveInstagramConnectAction(igToken, igUserId);
      if (result.ok) {
        setIgError(null);
        setIgToken("");
        router.refresh();
      } else {
        setIgError(result.error);
      }
    });
  }

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-2xl">
      <h1 className="font-[family-name:var(--font-anton)] text-2xl md:text-3xl uppercase tracking-wide">
        Pengaturan
      </h1>

      <p
        className={`text-sm rounded-lg border px-4 py-3 ${
          settings.effectivePractice
            ? "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"
            : "border-amber-500/60 bg-amber-500/10 text-amber-100"
        }`}
      >
        {settings.modeBanner}
      </p>
      <section className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Mode latihan
        </h2>
        <p className="text-sm text-[var(--muted)]">
          {settings.effectivePractice
            ? "Posting memakai penyimpanan lokal. Instagram tidak menerima apa pun."
            : "Mode siaran. Hanya draf yang kamu posting atau jadwalkan yang terkirim."}
        </p>
        {settings.envLocksPractice ? (
          <p className="text-sm text-amber-100">Dikunci oleh server.</p>
        ) : null}
        {modeError ? (
          <p className="text-sm text-destructive" role="alert">
            {modeError}
          </p>
        ) : null}
        {settings.effectivePractice ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending || (settings.envLocksPractice && settings.practiceMode)}
            onClick={() => {
              if (settings.envLocksPractice) return;
              setModeError(null);
              setConfirmLive(true);
            }}
          >
            Matikan Mode latihan
          </Button>
        ) : (
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setModeError(null);
              startTransition(async () => {
                const result = await setPracticeModeAction(true);
                if (result.ok) {
                  router.refresh();
                } else {
                  setModeError(result.error);
                }
              });
            }}
          >
            Nyalakan Mode latihan
          </Button>
        )}
        {settings.envLocksPractice && !settings.practiceMode ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setModeError(null);
              startTransition(async () => {
                const result = await setPracticeModeAction(true);
                if (result.ok) router.refresh();
                else setModeError(result.error);
              });
            }}
          >
            Nyalakan Mode latihan
          </Button>
        ) : null}
      </section>
      <Dialog open={confirmLive} onOpenChange={setConfirmLive}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Matikan Mode latihan?</DialogTitle>
            <DialogDescription>
              {account
                ? `Posting berikutnya akan dikirim ke Instagram sebagai @${account}. Draf yang sudah dijadwalkan ikut terkirim tanpa tombol lain.`
                : "Akun Instagram belum terhubung. Posting tetap diblokir sampai koneksi valid."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmLive(false)}>
              Batal
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await setPracticeModeAction(false);
                  if (result.ok) {
                    setConfirmLive(false);
                    setModeError(null);
                    router.refresh();
                  } else {
                    setModeError(result.error);
                    setConfirmLive(false);
                  }
                });
              }}
            >
              Matikan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {llmBanner ? (
        <p className="text-sm rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-[var(--muted)]">
          {llmBanner}
        </p>
      ) : null}
      {geminiPause ? (
        <p className="text-sm rounded-lg border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-amber-100">
          {geminiPause}
        </p>
      ) : null}
      <RegenerateDemoButton count={demoReviewCount} progress={regenerateProgress} />
      <section className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Template Berita Pro
        </h2>
        <p className="text-sm text-[var(--muted)]">
          Menggambar ulang draf yang sedang ditinjau dengan template Berita Pro. Status tetap
          perlu ditinjau. Tidak menyetujui, menjadwalkan, atau memposting.
        </p>
        {rerenderNote ? <p className="text-sm text-[var(--muted)]">{rerenderNote}</p> : null}
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (
              !window.confirm(
                "Gambar ulang semua draf yang sedang ditinjau dengan template Berita Pro? Ini tidak memposting.",
              )
            ) {
              return;
            }
            startTransition(async () => {
              const result = await queueBeritaProRerenderAction();
              if (result.ok) {
                setRerenderNote(
                  `${result.queued ?? 0} draf masuk antrian gambar dengan template baru.`,
                );
                router.refresh();
              } else {
                setRerenderNote(result.error);
              }
            });
          }}
        >
          Render ulang dengan template baru
        </Button>
      </section>

      <section className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Password akun
        </h2>
        <p className="text-sm text-[var(--muted)]">
          Mengganti password untuk akun yang sedang masuk. Sesi ini tetap aktif.
        </p>
        <form className="space-y-3" onSubmit={onPasswordSubmit}>
          <ControlledField
            label="Password saat ini"
            type="password"
            value={passwordForm.current}
            autoComplete="current-password"
            required
            onChange={(value) => setPasswordForm((form) => ({ ...form, current: value }))}
          />
          <ControlledField
            label="Password baru"
            type="password"
            value={passwordForm.next}
            autoComplete="new-password"
            required
            onChange={(value) => setPasswordForm((form) => ({ ...form, next: value }))}
          />
          <ControlledField
            label="Ulangi password baru"
            type="password"
            value={passwordForm.confirm}
            autoComplete="new-password"
            required
            onChange={(value) => setPasswordForm((form) => ({ ...form, confirm: value }))}
          />
          {passwordError ? (
            <p className="text-sm text-destructive" role="alert">
              {passwordError}
            </p>
          ) : null}
          {passwordSaved ? (
            <p className="text-sm text-[var(--muted)]">Password tersimpan.</p>
          ) : null}
          <Button type="submit" disabled={pending}>
            Ganti password
          </Button>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Merek</h2>
        <form className="space-y-3" onSubmit={onBrandSubmit}>
          <ControlledField
            label="Nama"
            value={brand.name}
            onChange={(value) => setBrand((b) => ({ ...b, name: value }))}
          />
          <ControlledField
            label="Nama akun"
            value={brand.handle}
            onChange={(value) => setBrand((b) => ({ ...b, handle: value }))}
          />
          <p className="text-xs text-[var(--muted)]">
            Kosongkan jika belum ada akun Instagram. Teks akun disembunyikan.
          </p>
          <ControlledField
            label="Inisial"
            value={brand.initial}
            maxLength={1}
            onChange={(value) => setBrand((b) => ({ ...b, initial: value }))}
          />
          <ControlledField
            label="Aksen"
            value={brand.accent}
            onChange={(value) => setBrand((b) => ({ ...b, accent: value }))}
          />
          <p className="text-xs text-[var(--muted)]">
            Tombol geser, garis, nomor slide, dan duotone foto. Bawaan #4E708C, cukup kontras di
            navy dan latar terang.
          </p>
          <ControlledField
            label="Teks pembuka"
            value={brand.kicker}
            onChange={(value) => setBrand((b) => ({ ...b, kicker: value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <ControlledField
              label="Jam mulai"
              value={brand.workStart}
              onChange={(value) => setBrand((b) => ({ ...b, workStart: value }))}
            />
            <ControlledField
              label="Jam selesai"
              value={brand.workEnd}
              onChange={(value) => setBrand((b) => ({ ...b, workEnd: value }))}
            />
          </div>
          <ControlledField
            label="Ambang lolos"
            type="number"
            value={String(brand.passThreshold)}
            onChange={(value) =>
              setBrand((b) => ({ ...b, passThreshold: Number(value) || 0 }))
            }
          />
          <div className="space-y-1">
            <Label htmlFor="defaultFormat">Format default</Label>
            <select
              id="defaultFormat"
              value={brand.defaultFormat}
              onChange={(e) =>
                setBrand((b) => ({
                  ...b,
                  defaultFormat: e.target.value as Settings["defaultFormat"],
                }))
              }
              className={fieldClass}
            >
              <option value="carousel_full">Carousel penuh</option>
              <option value="teaser_bio">Teaser + link bio</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="defaultTemplate">Template default</Label>
            <select
              id="defaultTemplate"
              value={brand.defaultTemplate}
              onChange={(e) =>
                setBrand((b) => ({
                  ...b,
                  defaultTemplate: e.target.value as Settings["defaultTemplate"],
                }))
              }
              className={fieldClass}
            >
              <option value="stabilo">Stabilo</option>
              <option value="foto_penuh">Foto penuh</option>
              <option value="serif">Serif</option>
              <option value="berita_pro">Berita Pro</option>
              <option value="catatan">Catatan</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="slideCount">Jumlah slide</Label>
            <select
              id="slideCount"
              value={brand.slideCount}
              onChange={(e) =>
                setBrand((b) => ({ ...b, slideCount: Number(e.target.value) === 2 ? 2 : 3 }))
              }
              className={fieldClass}
            >
              <option value={2}>2 — sampul + 1 isi</option>
              <option value={3}>3 — sampul + 2 isi</option>
            </select>
            <p className="text-xs text-[var(--muted)]">
              Maksimum 3. Slide isi terakhir memuat sumber dan ajakan baca di link bio.
            </p>
          </div>
          <ControlledField
            label="URL publik"
            value={brand.publicBaseUrl}
            onChange={(value) => setBrand((b) => ({ ...b, publicBaseUrl: value }))}
          />
          {isLocalPublicUrl(brand.publicBaseUrl) ? (
            <p className="text-xs text-amber-100" role="status">
              URL publik masih mengarah ke komputer ini. Instagram tidak bisa mengambil gambar dari alamat ini.
            </p>
          ) : null}
          {brandError ? (
            <p className="text-sm text-destructive" role="alert">
              {brandError}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            Simpan
          </Button>
        </form>
        <form
          className="space-y-3 border-t border-[var(--line)] pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            startTransition(async () => {
              const result = await saveLogoAction(data);
              if (result.ok) {
                setLogoError(null);
                setLogoNote("Logo tersimpan.");
                form.reset();
                router.refresh();
              } else {
                setLogoNote(null);
                setLogoError(result.error);
              }
            });
          }}
        >
          <Label htmlFor="logo">Logo</Label>
          {settings.hasLogo ? (
            <img
              src="/pengaturan/logo"
              alt="Logo Analyst Digest"
              className="h-16 w-auto max-w-[220px] rounded-md bg-[#172339] object-contain p-2"
            />
          ) : null}
          <p className="text-xs text-[var(--muted)]">
            {settings.hasLogo
              ? "Logo tersimpan. Kosongkan unggahan untuk tetap memakai logo bawaan Analyst Digest."
              : "Belum ada unggahan. Slide memakai logo bawaan Analyst Digest, atau inisial jika berkas bawaan tidak ada."}
          </p>
          <input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            className="block w-full text-sm text-[var(--ink)] file:mr-3 file:rounded-lg file:border file:border-[var(--line)] file:bg-[var(--panel-2)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--ink)]"
          />
          {logoError ? (
            <p className="text-sm text-destructive" role="alert">
              {logoError}
            </p>
          ) : null}
          {logoNote ? <p className="text-sm text-[var(--muted)]">{logoNote}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              Unggah logo
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await restoreLogoAction();
                  if (result.ok) {
                    setLogoError(null);
                    setLogoNote("Logo bawaan Analyst Digest dipakai.");
                    router.refresh();
                  } else {
                    setLogoNote(null);
                    setLogoError(result.error);
                  }
                });
              }}
            >
              Pakai logo bawaan
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Instagram</h2>
        <div className="space-y-2 text-xs text-[var(--muted)]">
          <p>Akun harus Business atau Creator.</p>
          <p>
            Instagram Login: tempel token long-lived dengan izin instagram_business_basic,
            instagram_business_content_publish, dan instagram_business_manage_insights. Token
            short-lived tidak bisa ditukar di sini.
          </p>
          <p>
            Facebook Login: akun Instagram Business yang tertaut ke Halaman Facebook. Token sistem
            atau halaman memakai izin instagram_basic, instagram_content_publish,
            instagram_manage_insights, pages_show_list, dan pages_read_engagement. Izin iklan
            (ads_*) tidak diperlukan. Token sistem tidak kedaluwarsa. Isi ID pengguna jika ada
            beberapa akun.
          </p>
        </div>
        {igError ? (
          <p className="text-sm text-destructive" role="alert">
            {igError}
          </p>
        ) : null}
        {settings.igStatus ? (
          <p
            className={`text-sm ${settings.igStatus.startsWith("Token") ? "text-amber-100" : ""}`}
            role="status"
          >
            {settings.igStatus}
          </p>
        ) : null}
        {settings.igWarning ? (
          <p className="text-sm text-amber-100" role="status">
            {settings.igWarning}
          </p>
        ) : null}
        {settings.igUsername && !settings.igNeedsToken && !settings.igWarning && !settings.igStatus?.startsWith("Token") ? (
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await disconnectInstagramAction();
                  if (!result.ok) {
                    setIgError(result.error);
                  } else {
                    setIgError(null);
                    router.refresh();
                  }
                });
              }}
            >
              Putuskan
            </Button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={onIgConnectSubmit}>
            <ControlledField
              label="ID pengguna Instagram"
              value={igUserId}
              autoComplete="off"
              onChange={setIgUserId}
            />
            <p className="text-xs text-[var(--muted)]">
              Opsional untuk Instagram Login. Untuk Facebook Login, isi jika ada beberapa akun.
            </p>
            <ControlledField
              label="Token akses (Instagram Login atau sistem Meta)"
              type="password"
              value={igToken}
              autoComplete="new-password"
              required
              onChange={setIgToken}
            />
            <p className="text-xs text-[var(--muted)]">
              Token tidak ditampilkan lagi setelah disimpan. Nama pengguna diisi dari Meta.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                Simpan koneksi
              </Button>
              {settings.igUsername ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await disconnectInstagramAction();
                      if (!result.ok) {
                        setIgError(result.error);
                      } else {
                        setIgError(null);
                        router.refresh();
                      }
                    });
                  }}
                >
                  Putuskan
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function ControlledField({
  label,
  value,
  onChange,
  type = "text",
  maxLength,
  autoComplete,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  maxLength?: number;
  autoComplete?: string;
  required?: boolean;
}) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[var(--panel)]"
      />
    </div>
  );
}
