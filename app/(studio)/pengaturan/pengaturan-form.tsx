"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import type { Settings, SettingsInput } from "@/src/studio/settings";
import {
  disconnectInstagramAction,
  saveInstagramConnectAction,
  saveSettingsAction,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fieldClass =
  "h-8 w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 text-sm";

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
    publicBaseUrl: settings.publicBaseUrl,
  };
}

export function PengaturanForm({
  settings,
  showMetaBanner,
  showLlmBanner,
}: {
  settings: Settings;
  showMetaBanner: boolean;
  showLlmBanner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [brandError, setBrandError] = useState<string | null>(null);
  const [igError, setIgError] = useState<string | null>(null);
  const [brand, setBrand] = useState<SettingsInput>(() => brandFromSettings(settings));
  const [igConnect, setIgConnect] = useState({
    igUserId: "",
    accessToken: "",
    igUsername: "",
  });

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

  function onIgConnectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveInstagramConnectAction(
        igConnect.igUserId,
        igConnect.accessToken,
        igConnect.igUsername,
      );
      if (result.ok) {
        setIgError(null);
        setIgConnect({ igUserId: "", accessToken: "", igUsername: "" });
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

      {showMetaBanner ? (
        <p className="text-sm rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-[var(--muted)]">
          Mode latihan: posting tidak dikirim ke Instagram.
        </p>
      ) : null}
      {showLlmBanner ? (
        <p className="text-sm rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-[var(--muted)]">
          AI demo: skor dan naskah dibuat lokal, tanpa biaya.
        </p>
      ) : null}

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
              <option value="catatan">Catatan</option>
            </select>
          </div>
          <ControlledField
            label="URL publik"
            value={brand.publicBaseUrl}
            onChange={(value) => setBrand((b) => ({ ...b, publicBaseUrl: value }))}
          />
          {brandError ? (
            <p className="text-sm text-destructive" role="alert">
              {brandError}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            Simpan
          </Button>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Instagram</h2>
        {igError ? (
          <p className="text-sm text-destructive" role="alert">
            {igError}
          </p>
        ) : null}
        {settings.igUsername ? (
          <div className="space-y-3">
            <p className="text-sm">Terhubung sebagai @{settings.igUsername}</p>
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
              value={igConnect.igUserId}
              autoComplete="off"
              required
              onChange={(value) => setIgConnect((c) => ({ ...c, igUserId: value }))}
            />
            <ControlledField
              label="Nama pengguna Instagram"
              value={igConnect.igUsername}
              autoComplete="off"
              required
              onChange={(value) => setIgConnect((c) => ({ ...c, igUsername: value }))}
            />
            <ControlledField
              label="Token akses"
              type="password"
              value={igConnect.accessToken}
              autoComplete="new-password"
              required
              onChange={(value) => setIgConnect((c) => ({ ...c, accessToken: value }))}
            />
            <p className="text-xs text-[var(--muted)]">
              Token tidak ditampilkan lagi setelah disimpan. Posting memakai API resmi Meta.
            </p>
            <Button type="submit" disabled={pending}>
              Simpan koneksi
            </Button>
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
        className="border-[var(--line)] bg-[var(--panel)]"
      />
    </div>
  );
}
