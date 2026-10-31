import { randomUUID } from "node:crypto";
import { hashPassword } from "../auth/password";
import { DEFAULT_ACCENT } from "../domain/brand";
import { normalizeCategories, normalizeKicker } from "../domain/tags";
import { enqueue, type JobName } from "../jobs/runner";
import { requeuePlaceholderRewrites } from "../studio/regenerate-demo";
import { readDefaultLogo } from "../render/brand-logo";
import type { Sql } from "./client";
import { seedDefaults } from "./seed";
import { DDL } from "./sql";

const DEMO_EMAIL = "admin@redaksi.local";
const DEMO_PASSWORD = "redaksi-dev-only";

/** Local preview draft. Seeded only when SEED_DEMO=1 and not in production. */
export const DEMO_REVIEW_DRAFT_ID = "00000000-0000-4000-8000-0000000000d1";

const PREVIEW_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABQCAIAAAAm3eQSAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAvklEQVRoge2SAQkAURSD1sIAl8L+xS7GePzBAqgsfJ5e6gRMwHpFdiHvLnUCJmC9IruQd5c6AROwXpFdyLtLnYAJWK/ILuTdpU7ABKxXZBfy7lInYALWK7ILeXepEzAB6xXZhby71AmYgPWK7ELeXeoETMB6RXYh7y51AiZgvSK7kHeXOgETsF6RXci7S52ACVivyC7k3aVOwASsV2QX8u5SJ2AC1iuyC3l3qRMwAesV2YW8u9QJmID1irx8oR/VFPx5QhpsSwAAAABJRU5ErkJggg==",
  "base64",
);

const BOOT_JOBS: JobName[] = ["scout.scan", "insights.sync", "ig.refresh"];

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ("code" in error && error.code === "23505") {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /duplicate key|unique constraint/i.test(message);
}

export async function applyDdl(sql: Sql): Promise<void> {
  const statements = DDL.split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    const text = statement.endsWith(";") ? statement : `${statement};`;
    await sql.rows(text);
  }
}

async function seedLocalPreview(sql: Sql): Promise<void> {
  const sourceOn = "00000000-0000-4000-8000-0000000000a1";
  const sourceOff = "00000000-0000-4000-8000-0000000000a2";
  const topicPassed = "00000000-0000-4000-8000-0000000000b1";
  const topicDrafted = "00000000-0000-4000-8000-0000000000b2";
  const topicWaiting = "00000000-0000-4000-8000-0000000000b3";
  const slides = [
    {
      role: "cover",
      kicker: "Ekspansi",
      headline: "Dua belas merek masuk Libya",
      body: "Cuplikan lokal untuk mengecek tombol studio.",
    },
    {
      role: "point",
      kicker: "Fakta",
      headline: "Rencana berjalan sampai 2028",
      body: "Satu fakta pada slide ini.",
    },
    {
      role: "cta",
      kicker: "Sumber",
      headline: "Baca selengkapnya di link bio",
      body: "Sumber: ANTARA Terkini.",
    },
  ];
  await sql.rows(
    `insert into sources (id, name, url, lang, enabled) values
       ($1, 'ANTARA Terkini', 'https://preview.local/antara', 'ID', true),
       ($2, 'Wawancara lokal', 'https://preview.local/wawancara', 'ID', false)
     on conflict (id) do nothing`,
    [sourceOn, sourceOff],
  );
  await sql.rows(
    `insert into topics (id, source_id, title, url, state, score, tags, score_reason, scored_at)
     values ($1, $2, 'Dua belas merek kuliner masuk Libya', 'https://preview.local/libya', 'passed', 82, $3::jsonb, 'Skor lokal untuk pratinjau.', now())
     on conflict (id) do nothing`,
    [topicPassed, sourceOn, JSON.stringify(["kuliner", "bisnis"])],
  );
  await sql.rows(
    `insert into topics (id, source_id, title, url, state, score, tags, score_reason, scored_at)
     values ($1, $2, 'Pengurus baru diminta fokus perlindungan', 'https://preview.local/kpad', 'drafted', 80, '[]'::jsonb, 'Skor lokal untuk pratinjau.', now())
     on conflict (id) do nothing`,
    [topicDrafted, sourceOn],
  );
  await sql.rows(
    `insert into topics (id, source_id, title, url, state, tags)
     values ($1, $2, 'Topik yang masih menunggu nilai', 'https://preview.local/menunggu', 'new', '[]'::jsonb)
     on conflict (id) do nothing`,
    [topicWaiting, sourceOn],
  );
  await sql.rows(
    `insert into drafts (
       id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, text_dirty
     ) values (
       $1, $2, 'needs_review', 'carousel_full', 'berita_pro', $3::jsonb, $4, $5::jsonb, $6::jsonb, 'lokal1', false
     ) on conflict (id) do nothing`,
    [
      DEMO_REVIEW_DRAFT_ID,
      topicDrafted,
      JSON.stringify(slides),
      "Dinas terkait meminta fokus pada perlindungan. Sumber: ANTARA Terkini.",
      JSON.stringify(["perlindungan", "bali", "berita"]),
      JSON.stringify(["Fokus perlindungan anak di Bali", "Langkah di era digital"]),
    ],
  );
  for (let index = 0; index < 3; index += 1) {
    await sql.rows(
      `insert into assets (id, draft_id, slide_index, bytes)
       values ($1, $2, $3, $4)
       on conflict (draft_id, slide_index) do nothing`,
      [`00000000-0000-4000-8000-000000000c0${index}`, DEMO_REVIEW_DRAFT_ID, index, PREVIEW_PNG],
    );
  }
}

async function seedDemoAdmin(sql: Sql): Promise<void> {
  // The known demo password stays off production even if SEED_DEMO=1 is still set.
  if (process.env.SEED_DEMO !== "1" || process.env.NODE_ENV === "production") {
    return;
  }
  await seedLocalPreview(sql);
  const existing = await sql.rows<{ id: string }>("select id from users where lower(email) = $1", [
    DEMO_EMAIL,
  ]);
  if (existing.length > 0) {
    return;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  try {
    await sql.rows(
      "insert into users (id, name, email, password_hash, role) values ($1, $2, $3, $4, $5)",
      [randomUUID(), "Admin", DEMO_EMAIL, passwordHash, "admin"],
    );
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }
}

async function enqueueIfUnfinished(sql: Sql, name: JobName): Promise<void> {
  await sql.tx(async (tx) => {
    const open = await tx.rows<{ id: string }>(
      "select id from jobs where name = $1 and finished_at is null limit 1",
      [name],
    );
    if (open.length > 0) {
      return;
    }
    await enqueue(tx, { name, payload: {}, runAt: new Date(), manual: false });
  });
}

function asTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((tag): tag is string => typeof tag === "string");
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asSlides(raw: unknown): Array<Record<string, unknown>> {
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((slide): slide is Record<string, unknown> => !!slide && typeof slide === "object");
}

async function normalizeStoredKickers(sql: Sql): Promise<void> {
  const rows = await sql.rows<{ id: string; slides: unknown; status: string }>(
    "select id, slides, status from drafts",
  );
  for (const row of rows) {
    let slides: Array<Record<string, unknown>>;
    try {
      slides = asSlides(row.slides);
    } catch {
      continue;
    }
    let changed = false;
    const next = slides.map((slide) => {
      if (typeof slide.kicker !== "string") {
        return slide;
      }
      const kicker = normalizeKicker(slide.kicker);
      if (kicker === slide.kicker) {
        return slide;
      }
      changed = true;
      return { ...slide, kicker };
    });
    if (!changed) {
      continue;
    }
    const rerender = row.status === "needs_review" || row.status === "drafted";
    await sql.rows(
      `update drafts
       set slides = $1::jsonb,
           text_dirty = case when $2 then true else text_dirty end,
           updated_at = now()
       where id = $3 and status = $4`,
      [JSON.stringify(next), rerender, row.id, row.status],
    );
  }
}

async function normalizeStoredTags(sql: Sql): Promise<void> {
  const rows = await sql.rows<{ id: string; tags: unknown }>("select id, tags from topics");
  for (const row of rows) {
    const tags = asTags(row.tags);
    const next = normalizeCategories(tags);
    if (JSON.stringify(tags) === JSON.stringify(next)) continue;
    await sql.rows("update topics set tags = $1::jsonb where id = $2", [JSON.stringify(next), row.id]);
  }
}

const SCHEMA_EXTRAS = [
  "alter table brand add column if not exists slide_count integer not null default 3",
  "alter table brand add column if not exists logo bytea",
  "alter table brand add column if not exists logo_type text",
  "alter table topics add column if not exists image_url text",
  `create table if not exists image_cache (
    url_hash text primary key,
    url text not null,
    bytes bytea not null,
    content_type text not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists gemini_gate (
    id integer primary key,
    paused_until timestamptz,
    pause_kind text,
    quota_metric text,
    quota_id text,
    quota_limit text,
    last_request_at timestamptz,
    constraint gemini_gate_one check (id = 1)
  )`,
  "insert into gemini_gate (id) values (1) on conflict (id) do nothing",
  "alter table ig_connection add column if not exists expires_at timestamptz",
  "alter table ig_connection add column if not exists checked_at timestamptz",
  "alter table ig_connection add column if not exists refreshed_at timestamptz",
  "alter table ig_connection add column if not exists refresh_error text",
  "alter table ig_connection add column if not exists token_error text",
];

export async function ensureSchemaExtras(sql: Sql): Promise<void> {
  for (const statement of SCHEMA_EXTRAS) {
    await sql.rows(statement);
  }
}

// Only the untouched seed brand moves to Analyst Digest. Existing drafts stay
// on their current template until an admin queues a re-render.
export async function migrateStoredBrand(sql: Sql): Promise<void> {
  const logo = readDefaultLogo();
  await sql.rows(`update brand set logo = $1, logo_type = $2 where id = 1 and logo is null`, [
    logo.bytes,
    logo.contentType,
  ]);
  await sql.rows(
    `update brand set
       name = 'Analyst Digest',
       handle = '',
       initial = 'A',
       accent = $1,
       default_template = 'berita_pro',
       default_format = 'carousel_full',
       slide_count = 3
     where id = 1
       and name = 'Redaksi'
       and handle = 'redaksi'
       and lower(accent) = '#d7ff3a'
       and default_template = 'serif'`,
    [DEFAULT_ACCENT],
  );
}

export async function boot(sql: Sql): Promise<void> {
  await applyDdl(sql);
  await ensureSchemaExtras(sql);
  await seedDefaults(sql);
  await migrateStoredBrand(sql);
  await normalizeStoredTags(sql);
  await normalizeStoredKickers(sql);
  await requeuePlaceholderRewrites(sql);
  await seedDemoAdmin(sql);
  for (const name of BOOT_JOBS) {
    await enqueueIfUnfinished(sql, name);
  }
}
