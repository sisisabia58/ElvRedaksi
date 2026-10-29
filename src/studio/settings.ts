import { z } from "zod";
import { can, type Role } from "../auth/rbac";
import { SLIDE_TEMPLATES, clampSlideCount, type SlideTemplateName } from "../domain/brand";
import type { Sql } from "../db/client";
import { readDefaultLogo } from "../render/brand-logo";

export type Settings = {
  name: string;
  handle: string;
  initial: string;
  accent: string;
  kicker: string;
  workStart: string;
  workEnd: string;
  passThreshold: number;
  defaultFormat: "carousel_full" | "teaser_bio";
  defaultTemplate: SlideTemplateName;
  slideCount: number;
  hasLogo: boolean;
  publicBaseUrl: string;
  igUsername: string | null;
};

export type SettingsInput = Omit<Settings, "igUsername" | "hasLogo">;

const settingsSchema = z.object({
  name: z.string(),
  handle: z.string().refine((value) => {
    const handle = value.trim();
    return handle === "" || /^[a-z0-9._]{2,30}$/.test(handle);
  }, "Handle kosong, atau 2–30 karakter: huruf kecil, angka, titik, atau garis bawah."),
  initial: z.string().length(1, "Inisial harus 1 karakter."),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Aksen harus warna hex, contoh #d7ff3a."),
  kicker: z.string(),
  workStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Jam harus HH:MM."),
  workEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Jam harus HH:MM."),
  passThreshold: z
    .number()
    .int("Ambang skor 0 sampai 100.")
    .min(0, "Ambang skor 0 sampai 100.")
    .max(100, "Ambang skor 0 sampai 100."),
  defaultFormat: z.enum(["carousel_full", "teaser_bio"]),
  defaultTemplate: z.enum(SLIDE_TEMPLATES),
  slideCount: z.number().int().min(2).max(3),
  publicBaseUrl: z.url("URL publik tidak valid."),
});

export async function getSettings(sql: Sql): Promise<Settings> {
  const rows = await sql.rows<{
    name: string;
    handle: string;
    initial: string;
    accent: string;
    kicker: string;
    work_start: string;
    work_end: string;
    pass_threshold: number;
    default_format: Settings["defaultFormat"];
    default_template: Settings["defaultTemplate"];
    slide_count: number;
    has_logo: boolean;
    public_base_url: string;
    ig_username: string | null;
  }>(
    `select b.name, b.handle, b.initial, b.accent, b.kicker, b.work_start, b.work_end,
            b.pass_threshold, b.default_format, b.default_template, b.slide_count,
            (b.logo is not null) as has_logo, b.public_base_url,
            ig.username as ig_username
     from brand b
     left join ig_connection ig on ig.id = 1
     where b.id = 1`,
  );
  const row = rows[0];
  return {
    name: row.name,
    handle: row.handle,
    initial: row.initial,
    accent: row.accent,
    kicker: row.kicker,
    workStart: row.work_start,
    workEnd: row.work_end,
    passThreshold: Number(row.pass_threshold),
    defaultFormat: row.default_format,
    defaultTemplate: row.default_template,
    slideCount: clampSlideCount(row.slide_count),
    hasLogo: Boolean(row.has_logo),
    publicBaseUrl: row.public_base_url,
    igUsername: row.ig_username,
  };
}

export async function saveSettings(sql: Sql, role: Role, input: SettingsInput): Promise<void> {
  if (!can(role, "settings.write")) {
    throw new Error("forbidden");
  }
  const parsed = settingsSchema.parse(input);
  await sql.rows(
    `update brand set
       name = $1, handle = $2, initial = $3, accent = $4, kicker = $5,
       work_start = $6, work_end = $7, pass_threshold = $8,
       default_format = $9, default_template = $10, slide_count = $11, public_base_url = $12
     where id = 1`,
    [
      parsed.name,
      parsed.handle.trim(),
      parsed.initial,
      parsed.accent,
      parsed.kicker,
      parsed.workStart,
      parsed.workEnd,
      parsed.passThreshold,
      parsed.defaultFormat,
      parsed.defaultTemplate,
      parsed.slideCount,
      parsed.publicBaseUrl,
    ],
  );
}

const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function saveBrandLogo(
  sql: Sql,
  role: Role,
  file: { bytes: Buffer; contentType: string },
): Promise<void> {
  if (!can(role, "settings.write")) {
    throw new Error("forbidden");
  }
  const contentType = file.contentType === "image/jpg" ? "image/jpeg" : file.contentType;
  if (!LOGO_TYPES.has(contentType)) {
    throw new Error("Logo harus PNG, JPEG, atau WebP.");
  }
  if (file.bytes.length === 0 || file.bytes.length > MAX_LOGO_BYTES) {
    throw new Error("Logo maksimal 512 KB.");
  }
  await sql.rows(`update brand set logo = $1, logo_type = $2 where id = 1`, [file.bytes, contentType]);
}

export async function restoreDefaultLogo(sql: Sql, role: Role): Promise<void> {
  if (!can(role, "settings.write")) {
    throw new Error("forbidden");
  }
  const logo = readDefaultLogo();
  await sql.rows(`update brand set logo = $1, logo_type = $2 where id = 1`, [logo.bytes, logo.contentType]);
}

export async function saveInstagramToken(
  sql: Sql,
  role: Role,
  input: { igUserId: string; accessToken: string; username: string },
): Promise<void> {
  if (!can(role, "settings.write")) {
    throw new Error("forbidden");
  }
  const igUserId = input.igUserId.trim();
  const accessToken = input.accessToken.trim();
  if (!igUserId || !accessToken) {
    await sql.rows(
      `update ig_connection
       set ig_user_id = null, access_token = null, username = null, connected_at = null
       where id = 1`,
    );
    return;
  }
  const username = input.username.trim();
  if (!username) {
    throw new Error("Nama pengguna Instagram wajib diisi.");
  }
  await sql.rows(
    `update ig_connection
     set ig_user_id = $1, access_token = $2, username = $3, connected_at = now()
     where id = 1`,
    [igUserId, accessToken, username],
  );
}
