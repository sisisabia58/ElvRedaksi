"use client";

import { useTransition } from "react";
import type { Settings } from "@/src/studio/settings";
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

export function PengaturanForm({
  settings,
  showMetaBanner,
  showLlmBanner,
}: {
  settings: Settings;
  showMetaBanner: boolean;
  showLlmBanner: boolean;
}) {
  const [pending, startTransition] = useTransition();

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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Brand</h2>
        <form
          className="space-y-3"
          action={(formData) => {
            const input = {
              name: String(formData.get("name") ?? ""),
              handle: String(formData.get("handle") ?? ""),
              initial: String(formData.get("initial") ?? ""),
              accent: String(formData.get("accent") ?? ""),
              kicker: String(formData.get("kicker") ?? ""),
              workStart: String(formData.get("workStart") ?? ""),
              workEnd: String(formData.get("workEnd") ?? ""),
              passThreshold: Number(formData.get("passThreshold") ?? 0),
              defaultFormat: String(formData.get("defaultFormat") ?? "teaser_bio") as Settings["defaultFormat"],
              defaultTemplate: String(formData.get("defaultTemplate") ?? "serif") as Settings["defaultTemplate"],
              publicBaseUrl: String(formData.get("publicBaseUrl") ?? ""),
            };
            startTransition(async () => {
              await saveSettingsAction(input);
            });
          }}
        >
          <Field label="Nama" name="name" defaultValue={settings.name} />
          <Field label="Handle" name="handle" defaultValue={settings.handle} />
          <Field label="Inisial" name="initial" defaultValue={settings.initial} maxLength={1} />
          <Field label="Aksen" name="accent" defaultValue={settings.accent} />
          <Field label="Kicker" name="kicker" defaultValue={settings.kicker} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jam mulai" name="workStart" defaultValue={settings.workStart} />
            <Field label="Jam selesai" name="workEnd" defaultValue={settings.workEnd} />
          </div>
          <Field
            label="Ambang lolos"
            name="passThreshold"
            type="number"
            defaultValue={String(settings.passThreshold)}
          />
          <div className="space-y-1">
            <Label htmlFor="defaultFormat">Format default</Label>
            <select
              id="defaultFormat"
              name="defaultFormat"
              defaultValue={settings.defaultFormat}
              className={fieldClass}
            >
              <option value="carousel_full">carousel_full</option>
              <option value="teaser_bio">teaser_bio</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="defaultTemplate">Template default</Label>
            <select
              id="defaultTemplate"
              name="defaultTemplate"
              defaultValue={settings.defaultTemplate}
              className={fieldClass}
            >
              <option value="stabilo">stabilo</option>
              <option value="foto_penuh">foto_penuh</option>
              <option value="serif">serif</option>
              <option value="catatan">catatan</option>
            </select>
          </div>
          <Field label="URL publik" name="publicBaseUrl" defaultValue={settings.publicBaseUrl} />
          <Button type="submit" disabled={pending}>
            Simpan
          </Button>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Instagram</h2>
        {settings.igUsername ? (
          <div className="space-y-3">
            <p className="text-sm">
              Terhubung sebagai @{settings.igUsername}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  await disconnectInstagramAction();
                });
              }}
            >
              Putuskan
            </Button>
          </div>
        ) : (
          <form
            className="space-y-3"
            action={(formData) => {
              startTransition(async () => {
                await saveInstagramConnectAction(
                  String(formData.get("igUserId") ?? ""),
                  String(formData.get("accessToken") ?? ""),
                );
              });
            }}
          >
            <Field label="ID pengguna Instagram" name="igUserId" autoComplete="off" />
            <Field label="Token akses" name="accessToken" type="password" autoComplete="new-password" />
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

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  maxLength,
  autoComplete,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  maxLength?: number;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={maxLength}
        autoComplete={autoComplete}
        className="border-[var(--line)] bg-[var(--panel)]"
      />
    </div>
  );
}
