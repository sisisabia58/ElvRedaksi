# Redaksi Content Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an original, self-hosted Instagram carousel newsroom: RSS in, four agents draft branded carousels, a human approves, the official Meta API publishes, and a public bio page sends readers back to the source article.

**Architecture:** One Next.js app. Pure domain rules decide status, work hours, and scores. Postgres stores sources, topics, drafts, renders, and jobs. A one-minute cron calls `POST /api/cron`, which runs due jobs. Scout, Analis, Copywriter, and Designer enqueue each other. Only a human can move a draft into `approved`, `scheduled`, or a manual `posted`. A worker may move `scheduled → posting → posted|failed`. Images are HTML templates rasterized to 1080×1350 PNGs. The default LLM and Meta adapters are local fakes so the app runs with no keys.

**Tech Stack:** Next.js 15 (App Router, TypeScript, Tailwind), shadcn/ui primitives, PostgreSQL 16, Vitest, PGlite for tests, Playwright only for PNG rasterizing, Docker Compose.

## Global Constraints

Verified against https://yes.jimmi.top/, https://yes.jimmi.top/presentasi/, https://studio.jimmi.top/login, https://studio.jimmi.top/baca, and `GET /s/3xqLi` on 28 Oct 2026 (Asia/Jakarta), plus the uploaded teardown. Do not copy Jimmi's code, character art, client Instagram photos, phone number, or the "1.480+" claim.

- UI copy is Indonesian. Code, tests, and logs for developers are English.
- Studio timezone is `Asia/Jakarta`. Work hours default `07:00`–`22:00`, start inclusive, end exclusive.
- Human approval before every publish. There is no fully automatic mode. The overview chip always reads `Mode: Semi-otomatis`.
- A worker may publish only after a human has already set `scheduled`. `needs_review → posting` throws `publish requires human approval`.
- Visuals are generated in-app or uploaded by the operator. Never download or hotlink a news photo.
- Every topic stores `url` and `sourceName`. Every slide renders `Sumber: {sourceName}`.
- Publishing uses Meta's official Instagram API only (`https://graph.instagram.com/v26.0`). No unofficial bots. No TikTok. No Reels.
- Carousel slides are exactly 1080×1350. Instagram crops a carousel to the first image; mixed ratios are forbidden. Minimum 2 images, maximum 10. This product uses 2 (teaser) or 3–6 (full).
- Default pass threshold is `70`. Sensitive topics still pass when the score clears the threshold; they show `Cek risiko` and do not post themselves.
- Scout and insights each run every 30 minutes. Auto scout/analis/copy/design wait for work hours. Manual buttons and the publisher ignore work hours.
- Insights numbers come only from the API. Never invent analytics. An account with no token sees an empty state.
- Client-owned keys, via env, on the operator's VPS. `LLM_PROVIDER=demo` and `META_PROVIDER=fake` are the local defaults.
- Roles: `admin`, `social_media`, `viewer`, `kol_specialist`. KOL Specialist can only read. Do not build Ruang KOL.
- Do not hardcode a WhatsApp number, batch scarcity, or another brand's posts. Contact is `CONTACT_WA`. Prices below are operator defaults and live in one config file.
- Login is invite-only. Copy: `Khusus tim. Akun dibuat oleh admin.` Button: `Masuk ke HQ`. Wrong password: `Email atau password salah.` No signup link.
- `robots` on studio routes: `noindex, nofollow`.

## Scope check

The marketing site, the studio, the agents, Meta publish, and the bio page are one pipeline, not five projects. Each task leaves tests green. After Task 11 the newsroom can draft and review with the demo LLM. After Task 12 it can "publish" through the fake adapter. Later tasks add the real adapter, analytics, bio, and the sales page.

## What was on the live site

Marketing (`yes.jimmi.top`, nginx/1.27.5, static HTML, Inter, light page, max reading width ~760px):

- Hero: "Capek nyari topik tiap hari?" plus four chips (24 jam, 14 hari, tanpa tim, 100% milik kamu) and a dashboard shot.
- Six client accounts, not three: @swishbait, @jimmimohtar, @pansos.creative, @brandwise.id, @pusatcorenetizen, @utusanpresidenkegelapan. Do not reproduce these grids.
- Ethics block: 2-slide teaser, AI visual, bio link, click tracking.
- Four pains, four named agents (Scout, Analis, Copywriter, Designer) plus "Kamu, pemimpin redaksinya".
- Audience chips: Media & portal berita, Brand & UMKM, Agency, Instansi & kampus, Homeless media, Personal branding.
- Embedded deck linking to `/presentasi/` (19 slides, prev/next/fullscreen).
- Salary calculator. Five roles sum to Rp19.000.000 / month: Scout 3.5jt, Analyst 4jt, Copywriter 4jt, Designer 4.5jt, Admin Sosmed 3jt. Buttons 3, 6, and 12 months. Twelve months shows Rp228.000.000 against a one-time Rp5.000.000, savings Rp223.000.000.
- Two packages on the page: Development Rp5.000.000 once, and Rp7.000.000 for the first year including VPS plus a starting AI balance. Running cost copy: AI about Rp200 per post, VPS about Rp1.5jt per year, paid to the vendors. Table for 5/10/15/30 posts a day.
- Eight FAQ answers. Instagram only. Business or Creator account. 14 days. Paid in full up front. No yearly fee to the seller.
- The deck and the studio screenshots are the spec for the app. Kalender and Pengaturan were not in the public images; their layouts are marked INFERRED below.

Studio (Next.js, `lang=id`, dark grid, Anton display, Geist sans). Tokens taken from the live CSS:

- `--bg #07080a`, `--panel #0e1014`, `--panel-2 #14171c`, `--line #1e222a`, `--ink #e8eaed`, `--muted #8a909a`, `--accent #d7ff3a`
- Agent colors: Scout `#38bdf8`, Analis `#a78bfa`, Copywriter `#fbbf24`, Designer `#f472b6`. Danger `#f87171`, success `#34d399`.
- Sidebar: Overview, Antrian Review (count badge), Radar Topik, Kalender, Analitik, Brain, then ADMIN: Sumber Topik, Tim & Akses, Pengaturan. Footer: name, role, logout.
- Mobile: horizontal nav, same pages, no install.
- Top right of the canvas, visible on the review hero shot: `AI Hari ini $0.105` and `Bulan ini $0.502`.

Screens to match:

- **Ruang Redaksi.** Greeting `SELAMAT {PAGI|SIANG|SORE|MALAM}, {NAME}`. Title `RUANG REDAKSI`. Chips `Mode: Semi-otomatis` and `AI aktif · jam kerja 07:00–22:00 WIB` (or `AI tidur` outside hours). Button `Cari topik sekarang`. Cards: `TOPIK MASUK 24 JAM` with `{n} menunggu dinilai`; `LOLOS ANALIS 24 JAM` with `{n} antre ditulis`; `SIAP DIREVIEW` (current `needs_review` count, accent) `Butuh approval tim`; `TERJADWAL` with `{n} sudah posting minggu ini`. Four agent cards with role and `Standby · aktif {relative}` or `Lagi jalan`. Activity list, newest first, label `update otomatis`. Live lines to reproduce: Scout `Belum ada topik baru`; Analis `Menilai 14 topik, 1 lolos ambang skor 70`; Copywriter `Draft siap: "{headline}"`; Designer `Gambar selesai untuk "{headline}"`.
- **Radar Topik.** Kicker `SCOUT + ANALIS`. Filters: `Lolos analis`, `Semua`, `Menunggu dinilai`, `Dilewati`, `Gagal`, `Sudah jadi draft`. Sort `Terbaru` / `Skor tertinggi` plus title search. Buttons `Nilai 0 topik sekarang` and `Cari topik sekarang`. A row shows the score, `Lolos` or `Dilewati`, tag, source, relative time, and `Buatkan konten`.
- **Antrian Review.** Kicker `MEJA EDITOR`. Intro: `Cek fakta, edit kalau perlu, lalu setujui dan jadwalkan. Tidak ada yang terposting tanpa persetujuan tim.` Tabs: `Perlu review`, `Disetujui`, `Terjadwal`, `Gagal posting`, `Sudah posting`, `Ditolak`, each with a count. `Pilih beberapa` selects cards for `Setujui`, `Jadwalkan`, `Tolak`. A card is a 4:5 cover, `1/2` or `1/n`, handle, score, optional `Cek risiko`, headline, source, relative time.
- **Editor.** Back link `Antrian review`. Tabs `Hasil render` and `Atur posisi foto` (a 0–100 vertical focal slider). Status, short link `…/s/{code}` with click count. Actions: `Posting sekarang`, `Setujui`, schedule date labeled `JADWAL POSTING (WIB)`, `Jadwalkan`, `Sudah diposting manual`, `Tolak`, `Hapus`. Per slide: kicker, template `Stabilo` | `Foto penuh` | `Serif` | `Catatan`, format `Carousel penuh` | `Teaser + link bio`, headline, alternates. `Simpan & render ulang` and `Simpan teks saja`. If the text changed after the last render, approve/schedule/post are blocked until re-render. Footer: `Download semua`, per-slide download, `Copy caption + hashtag`, `Render ulang`. Optional `Sekalian ke Story` (stated on the deck, not visible in the cropped editor).
- **Analitik.** Ranges `7 hari`, `28 hari`, `90 hari`. `Sinkronkan sekarang`. Cards: Followers (absolute delta), Views, Reach, Interaksi, Akun berinteraksi (percent vs the previous window). Charts `Views harian` and `Pertumbuhan followers`, plus a daily table behind `Lihat tabel harian`. Post table sorted by `Terbaru`, Views, Reach, Likes, Komentar, Saves, Shares, ER. ER is `(likes + comments + saves + shares) / views`, shown as `0.0%`. Zero views → `0.0%`.
- **Brain.** Files: `00-baca-dulu`, `01-brand-voice`, `02-kriteria-viral`, `03-aturan-caption`, `04-topik-sensitif`, `05-contoh-post`, `06-aturan-carousel`, plus `catatan-baru`. Markdown editor, `Simpan`, delete only for notes the user added. Analis and Copywriter receive the saved bodies on every run.
- **Sumber Topik.** Form: name, URL, language `Indonesia|Inggris`, kind `RSS/Atom`, `Tambah`. Rows: toggle, name, lang, URL, `{n} topik / {n} lolos (7 hari)`, `dicek {relative}`, delete. A failed fetch stores the error on the row.
- **Tim & Akses.** Invite name, email, role, `Buat akun`. The new password is shown once. Matrix: Admin (everything), Social Media (review, edit, approve, schedule, edit Brain), Viewer (read only), KOL Specialist (read only, Ruang KOL is not built).
- **Pengaturan.** INFERRED. Brand name, handle, avatar initial, accent hex, kicker, default format, default template, pass threshold, work hours, `PUBLIC_BASE_URL`, Instagram user id and access token (write-only; the page shows the connected username, never the token), and the provider banners.
- **Kalender.** INFERRED. A WIB week grid. Each scheduled or posted draft is a block on its day. Empty copy: `Belum ada yang dijadwalkan.`
- **Bio.** Public, light, no login. Background `#f7f6f2`, text `#0d0d0d`, avatar disc `#f6ee5f`, column `max-w-[640px]`, 3 columns, gap 3px, tile `aspect-[4/5]`, fallback `#e7e3d6`. Header `@{handle}` and `Klik postingan yang kamu lihat di Instagram untuk baca artikel lengkapnya di media aslinya.` Tiles link to `/s/{code}` with the source name on the bottom. Footer: `Konten di @{handle} merangkum berita dari media lain dengan sudut pandang sendiri.` / `Artikel lengkap dan liputan aslinya ada di situs media sumber.`
- **Short link.** `GET /s/{code}` returns 302 to the stored article URL and increments `click_count`, unless the request is a prefetch (`next-router-prefetch: 1`, `purpose: prefetch`, or `sec-purpose: prefetch`). Unknown code returns 404 `Tautan tidak ditemukan.`

## File map

| File | Responsibility |
| --- | --- |
| `src/domain/constants.ts` | Threshold, sizes, intervals, graph version |
| `src/domain/status.ts` | Draft transitions and the human gate |
| `src/domain/time.ts` | WIB work hours and greeting |
| `src/domain/score.ts` | Five aspects, 0–100, lolos/dilewati |
| `src/domain/metrics.ts` | ER, deltas, USD, relative time |
| `src/domain/code.ts` | 5-character short codes |
| `src/db/sql.ts` | The only DDL |
| `src/db/client.ts` | `Sql` adapter for Postgres and PGlite |
| `src/auth/password.ts` | scrypt hashes |
| `src/auth/rbac.ts` | Role to action |
| `src/auth/session.ts` | Cookie sessions |
| `src/studio/nav.ts` | Sidebar items |
| `src/studio/brain.ts` | Brain vault |
| `src/studio/settings.ts` | Brand, hours, token |
| `src/studio/sources.ts` | Source CRUD |
| `src/studio/topics.ts` | Radar queries |
| `src/studio/drafts.ts` | Review mutations |
| `src/studio/overview.ts` | Funnel counts |
| `src/studio/analytics.ts` | Windows and post table |
| `src/studio/team.ts` | Invite |
| `src/studio/bio.ts` | Public grid and clicks |
| `src/rss/parse.ts` | RSS/Atom items |
| `src/llm/provider.ts` | `LlmProvider`, demo, OpenAI |
| `src/agents/prompts.ts` | System prompts |
| `src/agents/analyst.ts` | Score JSON |
| `src/agents/copywriter.ts` | Slide JSON |
| `src/render/html.ts` | 1080×1350 templates |
| `src/render/raster.ts` | Playwright and fake rasterizers |
| `src/publish/publisher.ts` | Fake and Meta publishers |
| `src/jobs/runner.ts` | Claim, run, requeue |
| `src/jobs/handlers.ts` | The six job names |
| `app/(studio)/*` | Authenticated screens |
| `app/(marketing)/*` | Sales page and deck |
| `app/baca/page.tsx` | Public grid |
| `app/s/[code]/route.ts` | Count and redirect |
| `app/api/cron/route.ts` | Due jobs |
| `docker-compose.yml` | Postgres, web, cron |

---

### Task 1: Scaffold, tokens, and a booting app

**Files:**
- Create: `package.json` (via create-next-app, then the script edit below)
- Create: `src/domain/constants.ts`
- Create: `tests/constants.test.ts`
- Create: `app/globals.css` (replace the scaffold file)
- Test: `tests/constants.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `PASS_THRESHOLD_DEFAULT` (70), `SCOUT_INTERVAL_MS` (1_800_000), `INSIGHTS_INTERVAL_MS` (1_800_000), `SLIDE_WIDTH` (1080), `SLIDE_HEIGHT` (1350), `TIME_ZONE` (`"Asia/Jakarta"`), `GRAPH_VERSION` (`"v26.0"`), `GRAPH_BASE` (`"https://graph.instagram.com"`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  GRAPH_BASE,
  GRAPH_VERSION,
  INSIGHTS_INTERVAL_MS,
  PASS_THRESHOLD_DEFAULT,
  SCOUT_INTERVAL_MS,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TIME_ZONE,
} from "../src/domain/constants";

describe("constants", () => {
  it("matches the inspected product rules", () => {
    expect(PASS_THRESHOLD_DEFAULT).toBe(70);
    expect(SCOUT_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(INSIGHTS_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(SLIDE_WIDTH).toBe(1080);
    expect(SLIDE_HEIGHT).toBe(1350);
    expect(TIME_ZONE).toBe("Asia/Jakarta");
    expect(GRAPH_VERSION).toBe("v26.0");
    expect(GRAPH_BASE).toBe("https://graph.instagram.com");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/constants.test.ts`

Expected: FAIL because `src/domain/constants.ts` does not exist. If vitest itself is missing, do Step 3's install first, then re-run this and confirm the failure is the missing module.

- [ ] **Step 3: Scaffold and write the constants**

From `/workspace` (the repo root already has `docs/` and `.git`; do not run create-next-app against `.`):

```bash
npx create-next-app@15 tmp-scaffold --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --turbopack --disable-git --yes
rsync -a tmp-scaffold/ /workspace/ --exclude node_modules --exclude .git
rm -rf tmp-scaffold
npm install vitest zod fast-xml-parser @electric-sql/pglite playwright
npx playwright install chromium
npx shadcn@latest init -d --base-color neutral --yes
npx shadcn@latest add button input label textarea dialog dropdown-menu tabs sheet badge sonner separator -y
```

Set `package.json` scripts to:

```json
{
  "dev": "next dev --port 43123",
  "build": "next build",
  "start": "next start --port 43123",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Add `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

Create `src/domain/constants.ts`:

```ts
export const PASS_THRESHOLD_DEFAULT = 70;
export const SCOUT_INTERVAL_MS = 30 * 60 * 1000;
export const INSIGHTS_INTERVAL_MS = 30 * 60 * 1000;
export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;
export const TIME_ZONE = "Asia/Jakarta";
export const GRAPH_VERSION = "v26.0";
export const GRAPH_BASE = "https://graph.instagram.com";
```

Replace `app/globals.css` with the studio and marketing tokens. Keep Tailwind's import line that the scaffold generated (`@import "tailwindcss";` on Tailwind 4, or the three `@tailwind` lines on Tailwind 3) and add:

```css
:root {
  --bg: #07080a;
  --panel: #0e1014;
  --panel-2: #14171c;
  --line: #1e222a;
  --ink: #e8eaed;
  --muted: #8a909a;
  --accent: #d7ff3a;
  --scout: #38bdf8;
  --analis: #a78bfa;
  --copywriter: #fbbf24;
  --designer: #f472b6;
  --ok: #34d399;
  --bad: #f87171;
  --paper: #f7f6f2;
  --sale-bg: #f6f7f9;
  --sale-ink: #0d1117;
  --sale-muted: #586070;
  --sale-line: #e3e6eb;
  --sale-blue: #2f6bff;
  --sale-navy: #0a1430;
}
body { background: var(--bg); color: var(--ink); }
```

In `app/layout.tsx`, set `lang="id"` and load Anton from `next/font/google` as the CSS variable `--font-anton`. Page titles use `font-[family-name:var(--font-anton)] uppercase tracking-wide`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/constants.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts app src components tests tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs
git commit -m "feat: scaffold the newsroom app and pin product constants"
```

Use `next.config.mjs` if that is the name the scaffold wrote. Do not commit `docs/` yet; later tasks commit their own files. Do not commit `uploads/` or `agent-tools/`.

---

### Task 2: Status machine, work hours, score, and metrics

**Files:**
- Create: `src/domain/status.ts`
- Create: `src/domain/time.ts`
- Create: `src/domain/score.ts`
- Create: `src/domain/metrics.ts`
- Create: `src/domain/code.ts`
- Test: `tests/domain.test.ts`

**Interfaces:**
- Consumes: `TIME_ZONE` from `src/domain/constants.ts`
- Produces:
  - `type DraftStatus = "drafted" | "needs_review" | "approved" | "scheduled" | "posting" | "posted" | "failed" | "rejected"`
  - `type ActorKind = "human" | "worker"`
  - `assertTransition(actor: ActorKind, from: DraftStatus, to: DraftStatus, manual?: boolean): void`
  - `isWithinWorkHours(date: Date, startHHmm: string, endHHmm: string, timeZone?: string): boolean`
  - `greeting(date: Date, timeZone?: string): "pagi" | "siang" | "sore" | "malam"`
  - `type AspectScores = { relevansi: number; emosi: number; kebaruan: number; timing: number; shareability: number }`
  - `totalScore(aspects: AspectScores): number`
  - `verdict(score: number, threshold: number): "lolos" | "dilewati"`
  - `engagementRate(row: { views: number; likes: number; comments: number; saves: number; shares: number }): number`
  - `deltaPct(current: number, previous: number): number | null`
  - `formatUsd(amount: number): string`
  - `makeShortCode(bytes: Uint8Array): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { assertTransition } from "../src/domain/status";
import { greeting, isWithinWorkHours } from "../src/domain/time";
import { totalScore, verdict } from "../src/domain/score";
import { deltaPct, engagementRate, formatUsd } from "../src/domain/metrics";
import { makeShortCode } from "../src/domain/code";

const even = { relevansi: 20, emosi: 20, kebaruan: 20, timing: 10, shareability: 10 };

describe("draft gate", () => {
  it("lets a worker publish only a draft a human already scheduled", () => {
    expect(() => assertTransition("worker", "needs_review", "posting")).toThrow(
      /publish requires human approval/,
    );
    expect(() => assertTransition("worker", "scheduled", "posting")).not.toThrow();
    expect(() => assertTransition("worker", "posting", "posted")).not.toThrow();
    expect(() => assertTransition("worker", "posting", "failed")).not.toThrow();
  });

  it("requires the manual flag to skip the API", () => {
    expect(() => assertTransition("human", "needs_review", "posted")).toThrow(/manual/);
    expect(() => assertTransition("human", "needs_review", "posted", true)).not.toThrow();
    expect(() => assertTransition("human", "posted", "needs_review")).toThrow(/illegal/);
  });
});

describe("work hours", () => {
  it("uses Asia/Jakarta and treats the end as exclusive", () => {
    expect(isWithinWorkHours(new Date("2026-10-28T00:30:00Z"), "07:00", "22:00")).toBe(true);
    expect(isWithinWorkHours(new Date("2026-10-28T00:00:00Z"), "07:00", "22:00")).toBe(true);
    expect(isWithinWorkHours(new Date("2026-10-27T15:00:00Z"), "07:00", "22:00")).toBe(false);
    expect(greeting(new Date("2026-10-28T00:30:00Z"))).toBe("pagi");
    expect(greeting(new Date("2026-10-28T06:00:00Z"))).toBe("siang");
    expect(greeting(new Date("2026-10-28T11:00:00Z"))).toBe("sore");
    expect(greeting(new Date("2026-10-28T15:00:00Z"))).toBe("malam");
  });
});

describe("score and metrics", () => {
  it("sums five aspects of 0 to 20 and passes at 70", () => {
    expect(totalScore(even)).toBe(80);
    expect(verdict(80, 70)).toBe("lolos");
    expect(verdict(69, 70)).toBe("dilewati");
    expect(() => totalScore({ ...even, relevansi: 21 })).toThrow(/0-20/);
  });

  it("formats ER, follower-style percents, and USD like the studio", () => {
    expect(engagementRate({ views: 0, likes: 1, comments: 0, saves: 0, shares: 0 })).toBe(0);
    expect(engagementRate({ views: 200, likes: 1, comments: 1, saves: 1, shares: 1 })).toBe(2);
    expect(deltaPct(200, 100)).toBe(100);
    expect(deltaPct(10, 0)).toBeNull();
    expect(formatUsd(0.105)).toBe("$0.105");
  });

  it("builds an unambiguous 5 character code", () => {
    expect(makeShortCode(new Uint8Array([0, 0, 0, 0, 0]))).toBe("aaaaa");
    expect(makeShortCode(new Uint8Array([1, 2, 3, 4, 5]))).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/domain.test.ts`

Expected: FAIL with cannot find module `../src/domain/status`.

- [ ] **Step 3: Write the implementation**

`src/domain/status.ts`

```ts
export const DRAFT_STATUSES = [
  "drafted",
  "needs_review",
  "approved",
  "scheduled",
  "posting",
  "posted",
  "failed",
  "rejected",
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export type ActorKind = "human" | "worker";

const EDGES: Record<DraftStatus, DraftStatus[]> = {
  drafted: ["needs_review"],
  needs_review: ["approved", "scheduled", "rejected", "posted"],
  approved: ["scheduled", "posting", "rejected", "posted", "needs_review"],
  scheduled: ["posting", "needs_review", "rejected", "posted"],
  posting: ["posted", "failed"],
  posted: [],
  failed: ["posting", "needs_review"],
  rejected: ["needs_review"],
};

const WORKER = new Set(["scheduled>posting", "posting>posted", "posting>failed"]);

export function assertTransition(
  actor: ActorKind,
  from: DraftStatus,
  to: DraftStatus,
  manual = false,
): void {
  if (!EDGES[from].includes(to)) throw new Error(`illegal ${from} -> ${to}`);
  if (to === "posted" && from !== "posting" && !manual) {
    throw new Error("manual flag required");
  }
  if (actor === "worker" && !WORKER.has(`${from}>${to}`)) {
    throw new Error("publish requires human approval");
  }
}
```

`src/domain/time.ts`

```ts
import { TIME_ZONE } from "./constants";

function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { hour: Number(bag.hour), minute: Number(bag.minute) };
}

export function isWithinWorkHours(
  date: Date,
  startHHmm: string,
  endHHmm: string,
  timeZone = TIME_ZONE,
): boolean {
  const { hour, minute } = parts(date, timeZone);
  const now = hour * 60 + minute;
  const [sh, sm] = startHHmm.split(":").map(Number);
  const [eh, em] = endHHmm.split(":").map(Number);
  return now >= sh * 60 + sm && now < eh * 60 + em;
}

export function greeting(date: Date, timeZone = TIME_ZONE): "pagi" | "siang" | "sore" | "malam" {
  const { hour } = parts(date, timeZone);
  if (hour < 11) return "pagi";
  if (hour < 15) return "siang";
  if (hour < 19) return "sore";
  return "malam";
}
```

`src/domain/score.ts`

```ts
export type AspectScores = {
  relevansi: number;
  emosi: number;
  kebaruan: number;
  timing: number;
  shareability: number;
};

const KEYS = ["relevansi", "emosi", "kebaruan", "timing", "shareability"] as const;

export function totalScore(aspects: AspectScores): number {
  let sum = 0;
  for (const key of KEYS) {
    const n = aspects[key];
    if (!Number.isInteger(n) || n < 0 || n > 20) throw new Error(`${key} must be an integer 0-20`);
    sum += n;
  }
  return sum;
}

export function verdict(score: number, threshold: number): "lolos" | "dilewati" {
  return score >= threshold ? "lolos" : "dilewati";
}
```

`src/domain/metrics.ts`

```ts
export function engagementRate(row: {
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
}): number {
  if (row.views <= 0) return 0;
  return ((row.likes + row.comments + row.saves + row.shares) / row.views) * 100;
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(3)}`;
}
```

`src/domain/code.ts`

```ts
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeShortCode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < 5; i++) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/domain.test.ts`

Expected: PASS. `2026-10-28T06:00:00Z` is 13:00 WIB (`siang`). `2026-10-28T11:00:00Z` is 18:00 WIB (`sore`). `2026-10-28T15:00:00Z` is 22:00 WIB (`malam`). If a boundary fails, fix `greeting`, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/domain tests/domain.test.ts
git commit -m "feat: add the publish gate, work hours, and score rules"
```

---

### Task 3: Postgres schema, seed brain, and the SQL adapter

**Files:**
- Create: `src/db/sql.ts`
- Create: `src/db/client.ts`
- Create: `src/db/seed.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: nothing from Task 2 (the DDL uses the same status strings)
- Produces:
  - `type Sql = { rows<T>(text: string, params?: unknown[]): Promise<T[]>; tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> }`
  - `createTestSql(): Promise<Sql>`
  - `seedDefaults(sql: Sql): Promise<void>` which inserts one `brand` row and the seven brain docs, and does nothing if `brand.id = 1` already exists

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";

describe("schema", () => {
  it("seeds a brand, the brain vault, and rejects a second topic with the same url", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const docs = await sql.rows<{ slug: string }>("select slug from brain_docs order by slug");
    expect(docs.map((d) => d.slug)).toEqual([
      "00-baca-dulu",
      "01-brand-voice",
      "02-kriteria-viral",
      "03-aturan-caption",
      "04-topik-sensitif",
      "05-contoh-post",
      "06-aturan-carousel",
    ]);
    const brand = await sql.rows<{ handle: string; pass_threshold: number }>(
      "select handle, pass_threshold from brand where id = 1",
    );
    expect(brand[0]).toMatchObject({ handle: "redaksi", pass_threshold: 70 });
    await sql.rows(
      "insert into sources (id, name, url, lang) values ($1,$2,$3,$4)",
      ["11111111-1111-1111-1111-111111111111", "Contoh", "https://example.com/feed", "ID"],
    );
    await sql.rows(
      "insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)",
      ["22222222-2222-2222-2222-222222222222", "11111111-1111-1111-1111-111111111111", "Satu", "https://example.com/a"],
    );
    await expect(
      sql.rows(
        "insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)",
        ["33333333-3333-3333-3333-333333333333", "11111111-1111-1111-1111-111111111111", "Dua", "https://example.com/a"],
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db.test.ts`

Expected: FAIL with cannot find module `../src/db/client`.

- [ ] **Step 3: Write the schema, adapter, and seed**

`src/db/sql.ts` exports `DDL` as one string. Execute it in order. Tables and the columns this plan's later tasks read:

```sql
create table if not exists brand (
  id integer primary key default 1,
  name text not null,
  handle text not null,
  initial text not null,
  accent text not null,
  kicker text not null,
  work_start text not null default '07:00',
  work_end text not null default '22:00',
  pass_threshold integer not null default 70,
  default_format text not null default 'teaser_bio',
  default_template text not null default 'serif',
  public_base_url text not null default 'http://127.0.0.1:43123',
  constraint brand_one check (id = 1)
);

create table if not exists users (
  id uuid primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin','social_media','viewer','kol_specialist')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null
);

create table if not exists brain_docs (
  slug text primary key,
  title text not null,
  body text not null,
  locked boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists sources (
  id uuid primary key,
  name text not null,
  url text not null,
  lang text not null check (lang in ('ID','EN')),
  kind text not null default 'rss',
  enabled boolean not null default true,
  last_fetched_at timestamptz,
  last_error text
);

create table if not exists topics (
  id uuid primary key,
  source_id uuid not null references sources(id) on delete cascade,
  title text not null,
  url text not null unique,
  summary text not null default '',
  excerpt text not null default '',
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  state text not null default 'new' check (state in ('new','scored','passed','skipped','drafted','failed')),
  score integer,
  aspects jsonb,
  tags jsonb not null default '[]',
  sensitive boolean not null default false,
  sensitive_reason text,
  blocked boolean not null default false,
  score_reason text,
  scored_at timestamptz,
  error text
);

create table if not exists drafts (
  id uuid primary key,
  topic_id uuid not null references topics(id),
  status text not null default 'drafted',
  format text not null,
  template text not null,
  slides jsonb not null,
  caption text not null,
  hashtags jsonb not null,
  alt_headlines jsonb not null,
  focal_y integer not null default 50,
  share_to_story boolean not null default false,
  text_dirty boolean not null default false,
  scheduled_at timestamptz,
  posted_at timestamptz,
  ig_media_id text,
  story_media_id text,
  story_error text,
  error text,
  short_code text not null unique,
  click_count integer not null default 0,
  manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key,
  draft_id uuid not null references drafts(id) on delete cascade,
  slide_index integer not null,
  bytes bytea not null,
  created_at timestamptz not null default now(),
  unique (draft_id, slide_index)
);

create table if not exists activity (
  id uuid primary key,
  agent text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists llm_spend (
  id uuid primary key,
  agent text not null,
  model text not null,
  cost_usd numeric(12,6) not null,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key,
  name text not null,
  payload jsonb not null,
  run_at timestamptz not null,
  manual boolean not null default false,
  locked_at timestamptz,
  finished_at timestamptz,
  error text,
  attempts integer not null default 0
);

create table if not exists ig_connection (
  id integer primary key default 1,
  ig_user_id text,
  access_token text,
  username text,
  connected_at timestamptz,
  constraint ig_one check (id = 1)
);

create table if not exists insight_snapshots (
  id uuid primary key,
  taken_at timestamptz not null default now(),
  followers integer not null,
  views integer not null default 0,
  reach integer not null default 0,
  interactions integer not null default 0,
  accounts_engaged integer,
  daily jsonb not null
);

create table if not exists post_insights (
  draft_id uuid primary key references drafts(id) on delete cascade,
  views integer not null default 0,
  reach integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  saves integer not null default 0,
  shares integer not null default 0,
  synced_at timestamptz not null default now()
);

insert into ig_connection (id) values (1) on conflict (id) do nothing;
```

`src/db/client.ts`

```ts
import { PGlite } from "@electric-sql/pglite";
import { DDL } from "./sql";

export type Sql = {
  rows<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
};

function fromPglite(pg: PGlite): Sql {
  const sql: Sql = {
    async rows<T>(text: string, params: unknown[] = []) {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
    async tx<T>(fn: (inner: Sql) => Promise<T>) {
      await pg.query("begin");
      try {
        const value = await fn(sql);
        await pg.query("commit");
        return value;
      } catch (error) {
        await pg.query("rollback");
        throw error;
      }
    },
  };
  return sql;
}

export async function createTestSql(): Promise<Sql> {
  const pg = new PGlite();
  const sql = fromPglite(pg);
  for (const statement of DDL.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await pg.query(statement.endsWith(";") ? statement : `${statement};`);
  }
  return sql;
}

export function createPostgresSql(query: (text: string, params: unknown[]) => Promise<unknown[]>): Sql {
  const sql: Sql = {
    async rows<T>(text: string, params: unknown[] = []) {
      return (await query(text, params)) as T[];
    },
    async tx(fn) {
      await query("begin", []);
      try {
        const value = await fn(sql);
        await query("commit", []);
        return value;
      } catch (error) {
        await query("rollback", []);
        throw error;
      }
    },
  };
  return sql;
}
```

Split `DDL` on `;\n` only. Keep each statement separated by that sequence in `src/db/sql.ts`. Do not put a semicolon inside a string.

`src/db/seed.ts` inserts the brand and the seven docs inside `on conflict do nothing`.

Brand row: `name = Redaksi`, `handle = redaksi`, `initial = R`, `accent = #d7ff3a`, `kicker = Catatan redaksi`, `pass_threshold = 70`, `default_format = teaser_bio`, `default_template = serif`.

Brain bodies, saved as the `body` text (this is original seed copy, not a paste of the live vault):

- `00-baca-dulu` title `Baca dulu`. Body: `Analis dan Copywriter membaca semua catatan ini setiap kali bekerja. Ubah gaya, ambang viral, dan larangan di sini. Jangan tempel artikel orang lain.`
- `01-brand-voice` title `Gaya bahasa`. Body: `Bahasa Indonesia santai, kalimat pendek, sapaan "kamu". Jangan mengaku telah membaca lebih dari cuplikan. Jangan menjual.`
- `02-kriteria-viral` title `Kriteria viral`. Body must tell the model to score five aspects, each an integer 0–20: Relevansi (marketing, iklan, media sosial, AI untuk marketing tinggi; gosip, kripto, dan politik rendah), Emosi, Kebaruan (fitur atau rilis, bukan opini daur ulang), Timing (turun setelah 48 jam), Shareability. Lolos pada 70. Sertakan tag singkat.
- `03-aturan-caption` title `Aturan caption`. Body: `Caption 2–4 kalimat plus 3–8 hashtag tanpa tanda pagar di data. Sebut nama sumber.`
- `04-topik-sensitif` title `Topik sensitif`. Body: `Tandai sensitif, jangan otomatis buang, untuk kecelakaan, kematian, kesehatan mental, konflik bersenjata, dan tuduhan kriminal yang belum diputuskan. blocked=true hanya jika catatan ini menyebut topiknya sebagai larangan keras.`
- `05-contoh-post` title `Contoh post`. Body: `Hook satu napas, satu fakta per slide, slide terakhir ajakan atau pendapat.`
- `06-aturan-carousel` title `Aturan carousel`. Body: `Carousel penuh: 1 sampul + 2 sampai 5 slide poin. Teaser: sampul + 1 slide CTA ke link bio. Setiap slide memuat nama sumber. Jangan minta foto dari situs berita.`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/db.test.ts`

Expected: PASS. A duplicate URL raises a Postgres unique-violation error.

- [ ] **Step 5: Commit**

```bash
git add src/db tests/db.test.ts
git commit -m "feat: add the newsroom schema and default brain"
```

---

### Task 4: Auth, roles, login, and the studio shell

**Files:**
- Create: `src/auth/password.ts`
- Create: `src/auth/rbac.ts`
- Create: `src/auth/session.ts`
- Create: `src/studio/nav.ts`
- Create: `src/studio/spend.ts`
- Create: `app/login/page.tsx`
- Create: `app/login/actions.ts`
- Create: `app/(studio)/layout.tsx`
- Create: `components/studio/shell.tsx`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: `Sql` from `src/db/client.ts`
- Produces:
  - `hashPassword(plain: string): Promise<string>` and `verifyPassword(plain: string, hash: string): Promise<boolean>`
  - `type Role = "admin" | "social_media" | "viewer" | "kol_specialist"`
  - `type Action = "studio.read" | "review.write" | "brain.write" | "source.write" | "team.write" | "settings.write" | "publish"`
  - `can(role: Role, action: Action): boolean`
  - `createSession(sql: Sql, userId: string): Promise<{ token: string; expiresAt: Date }>`
  - `userForToken(sql: Sql, token: string): Promise<{ id: string; name: string; role: Role } | null>`
  - `navItems(role: Role): { href: string; label: string; group: "editor" | "admin" }[]`
  - `spendSummary(sql: Sql, now: Date): Promise<{ today: number; month: number }>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { can } from "../src/auth/rbac";
import { createSession, userForToken } from "../src/auth/session";
import { navItems } from "../src/studio/nav";
import { spendSummary } from "../src/studio/spend";

describe("auth", () => {
  it("round-trips a password and hides the raw session token", async () => {
    const hash = await hashPassword("redaksi-dev-only");
    expect(hash).not.toContain("redaksi-dev-only");
    expect(await verifyPassword("redaksi-dev-only", hash)).toBe(true);
    expect(await verifyPassword("salah", hash)).toBe(false);
    const sql = await createTestSql();
    await sql.rows(
      "insert into users (id, name, email, password_hash, role) values ($1,$2,$3,$4,$5)",
      ["44444444-4444-4444-4444-444444444444", "Ade", "ade@redaksi.local", hash, "admin"],
    );
    const session = await createSession(sql, "44444444-4444-4444-4444-444444444444");
    expect(await userForToken(sql, session.token)).toMatchObject({ name: "Ade", role: "admin" });
    expect(await userForToken(sql, "bukan-token")).toBeNull();
    const stored = await sql.rows<{ token_hash: string }>("select token_hash from sessions");
    expect(stored[0].token_hash).not.toBe(session.token);
  });

  it("keeps viewers out of admin and publish actions", () => {
    expect(can("admin", "settings.write")).toBe(true);
    expect(can("social_media", "review.write")).toBe(true);
    expect(can("social_media", "brain.write")).toBe(true);
    expect(can("social_media", "source.write")).toBe(false);
    expect(can("viewer", "publish")).toBe(false);
    expect(can("kol_specialist", "studio.read")).toBe(true);
    expect(can("kol_specialist", "review.write")).toBe(false);
    expect(navItems("viewer").some((item) => item.group === "admin")).toBe(false);
    expect(navItems("admin").map((item) => item.label)).toEqual([
      "Overview",
      "Antrian Review",
      "Radar Topik",
      "Kalender",
      "Analitik",
      "Brain",
      "Sumber Topik",
      "Tim & Akses",
      "Pengaturan",
    ]);
  });

  it("sums USD spend for today and the month in Jakarta", async () => {
    const sql = await createTestSql();
    await sql.rows(
      "insert into llm_spend (id, agent, model, cost_usd, created_at) values ($1,$2,$3,$4,$5)",
      ["55555555-5555-5555-5555-555555555555", "analis", "demo", 0.105, "2026-10-28T02:00:00Z"],
    );
    const summary = await spendSummary(sql, new Date("2026-10-28T10:00:00Z"));
    expect(summary.today).toBeCloseTo(0.105);
    expect(summary.month).toBeCloseTo(0.105);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/auth.test.ts`

Expected: FAIL with cannot find module `../src/auth/password`.

- [ ] **Step 3: Write auth, nav, login, and the shell**

`src/auth/password.ts` uses `node:crypto` `scrypt` (keylen 32) and stores `scrypt$<salt hex>$<hash hex>`. `verifyPassword` returns false on a malformed hash.

`src/auth/rbac.ts`

```ts
export const ROLES = ["admin", "social_media", "viewer", "kol_specialist"] as const;
export type Role = (typeof ROLES)[number];
export const ACTIONS = [
  "studio.read",
  "review.write",
  "brain.write",
  "source.write",
  "team.write",
  "settings.write",
  "publish",
] as const;
export type Action = (typeof ACTIONS)[number];

const GRANTS: Record<Role, Action[]> = {
  admin: [...ACTIONS],
  social_media: ["studio.read", "review.write", "brain.write", "publish"],
  viewer: ["studio.read"],
  kol_specialist: ["studio.read"],
};

export function can(role: Role, action: Action): boolean {
  return GRANTS[role].includes(action);
}
```

`src/auth/session.ts`: token is 32 random bytes, hex. Store `sha256` hex in `sessions.token_hash`. Expire in 30 days. `userForToken` joins `users` and returns null when `expires_at <= now()`.

`src/studio/nav.ts`: editor hrefs `/overview /review /radar /kalender /analitik /brain`. Admin hrefs `/sumber /tim /pengaturan` only when `can(role, "source.write")` is true for the admin group. Viewers get the six editor links. Labels are the nine strings in the test, in that order, for an admin.

`src/studio/spend.ts`: sum `cost_usd` where `created_at` falls on the Jakarta calendar day of `now`, and where it falls in the Jakarta calendar month. Cast `cost_usd` with `Number`.

`app/login/page.tsx` is a server component. Centered card, max width `sm`, on the dark grid. Eyebrow `REDAKSI`, title `Studio` in Anton, line `Khusus tim. Akun dibuat oleh admin.` Form posts to the server action with email and password, both required. Button `Masuk ke HQ`. On failure the action redirects to `/login?error=1`, and the page shows `Email atau password salah.` No other link. Export `metadata` with `robots: { index: false, follow: false }`.

`app/login/actions.ts`: look up the user by lowercased email, verify the password, create a session, set cookie `redaksi_session` (`httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure` when `NODE_ENV === "production"`, `maxAge` 30 days), update `last_login_at`, redirect to `/overview`. Any miss redirects to `/login?error=1`. Do not say which field was wrong.

`app/(studio)/layout.tsx` reads the cookie, loads the user, and redirects to `/login` when missing. It renders `Shell`.

`components/studio/shell.tsx` (server component): left sidebar on `md+`, 240px, background `--panel`, active link with accent text. Wordmark `REDAKSI` and `@${brand.handle}` (query brand; if the table is empty, `@redaksi`). Nav from `navItems`. Antrian Review shows a lime count pill of `needs_review` drafts. Bottom: initial disc, name, role label (`Admin`, `Social Media`, `Viewer`, `KOL Specialist`), and a form button `Keluar` that deletes the session and clears the cookie. Main column: top bar with `SpendMeter` reading `AI Hari ini {formatUsd(today)}` and `Bulan ini {formatUsd(month)}`. Below `md`, the sidebar is hidden and a horizontal scroller of the same links sits under the top bar. Main background is `--bg` with a faint 32px grid (`linear-gradient` lines at `--line`).

Add empty route files only for `/overview` so login has a landing page: `app/(studio)/overview/page.tsx` renders the heading `RUANG REDAKSI` and the four funnel labels with zeros by calling `funnelCounts`. Implement `funnelCounts` here, in `src/studio/overview.ts`, even though the agent cards arrive in Task 14. The function returns:

```ts
export type Funnel = {
  arrived24h: number;
  waitingScore: number;
  passed24h: number;
  waitingDraft: number;
  needsReview: number;
  scheduled: number;
  postedThisWeek: number;
};
```

Definitions: `arrived24h` is topics with `discovered_at > now() - interval '24 hours'`. `waitingScore` is topics with `state = 'new'`. `passed24h` is topics with `state = 'passed'` and `scored_at > now() - interval '24 hours'`. `waitingDraft` is `state = 'passed'`. `needsReview` is drafts with `status = 'needs_review'`. `scheduled` is drafts with `status = 'scheduled'`. `postedThisWeek` is drafts with `status = 'posted'` and `posted_at` in the Jakarta week starting Monday 00:00. Task 14 adds the agent cards to this same page; do not invent a second overview.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/auth.test.ts`

Expected: PASS, 3 tests.

Also run: `npx vitest run`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth src/studio/nav.ts src/studio/spend.ts src/studio/overview.ts app/login app/\(studio\) components/studio tests/auth.test.ts
git commit -m "feat: add invite-only login and the studio shell"
```

---

### Task 5: Brain vault and Pengaturan

**Files:**
- Create: `src/studio/brain.ts`
- Create: `src/studio/settings.ts`
- Create: `app/(studio)/brain/page.tsx`
- Create: `app/(studio)/brain/actions.ts`
- Create: `app/(studio)/pengaturan/page.tsx`
- Create: `app/(studio)/pengaturan/actions.ts`
- Test: `tests/brain-settings.test.ts`

**Interfaces:**
- Consumes: `can`, `Sql`, `seedDefaults`
- Produces:
  - `listBrain(sql: Sql): Promise<{ slug: string; title: string; body: string; locked: boolean; updatedAt: Date }[]>`
  - `saveBrain(sql: Sql, role: Role, input: { slug: string; body: string }): Promise<void>`
  - `createNote(sql: Sql, role: Role, title: string): Promise<{ slug: string }>`
  - `deleteNote(sql: Sql, role: Role, slug: string): Promise<void>`
  - `getSettings(sql: Sql): Promise<Settings>`
  - `saveSettings(sql: Sql, role: Role, input: SettingsInput): Promise<void>`
  - `saveInstagramToken(sql: Sql, role: Role, input: { igUserId: string; accessToken: string; username: string }): Promise<void>`

`Settings` is `{ name, handle, initial, accent, kicker, workStart, workEnd, passThreshold, defaultFormat: "carousel_full" | "teaser_bio", defaultTemplate: "stabilo" | "foto_penuh" | "serif" | "catatan", publicBaseUrl, igUsername: string | null }`. `SettingsInput` is that object without `igUsername`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { createNote, deleteNote, listBrain, saveBrain } from "../src/studio/brain";
import { getSettings, saveInstagramToken, saveSettings } from "../src/studio/settings";

describe("brain and settings", () => {
  it("lets an editor edit brain and blocks deleting a locked doc", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await saveBrain(sql, "social_media", { slug: "01-brand-voice", body: "Lebih pendek." });
    const docs = await listBrain(sql);
    expect(docs.find((d) => d.slug === "01-brand-voice")?.body).toBe("Lebih pendek.");
    await expect(deleteNote(sql, "admin", "01-brand-voice")).rejects.toThrow(/terkunci/);
    const note = await createNote(sql, "admin", "Sudut kampus");
    expect(note.slug.startsWith("catatan-")).toBe(true);
    await deleteNote(sql, "admin", note.slug);
    await expect(saveBrain(sql, "viewer", { slug: "01-brand-voice", body: "x" })).rejects.toThrow(/forbidden/);
  });

  it("saves brand fields and never returns the Instagram token", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await saveSettings(sql, "admin", {
      name: "Meja",
      handle: "meja",
      initial: "M",
      accent: "#d7ff3a",
      kicker: "Catatan",
      workStart: "08:00",
      workEnd: "21:00",
      passThreshold: 75,
      defaultFormat: "carousel_full",
      defaultTemplate: "stabilo",
      publicBaseUrl: "https://studio.example.com",
    });
    await saveInstagramToken(sql, "admin", {
      igUserId: "1789",
      accessToken: "super-secret",
      username: "meja",
    });
    const settings = await getSettings(sql);
    expect(settings.passThreshold).toBe(75);
    expect(settings.igUsername).toBe("meja");
    expect(JSON.stringify(settings)).not.toContain("super-secret");
    await expect(saveSettings(sql, "social_media", settings)).rejects.toThrow(/forbidden/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/brain-settings.test.ts`

Expected: FAIL with cannot find module `../src/studio/brain`.

- [ ] **Step 3: Write the vault, the settings store, and both pages**

`saveBrain` throws `Error("forbidden")` when `!can(role, "brain.write")`. It updates `body` and `updated_at` for an existing slug. Empty body throws `Error("Catatan kosong")`.

`createNote` requires `brain.write`. Slug is `catatan-` plus 6 hex chars from `crypto.randomBytes`. `locked = false`. Title is the argument, trimmed, max 80 chars.

`deleteNote` requires `brain.write`. If `locked` is true, throw `Error("Dokumen terkunci")`.

`saveSettings` requires `settings.write`. Validate with zod: handle `^[a-z0-9._]{2,30}$`, accent `^#[0-9a-fA-F]{6}$`, times `^([01]\d|2[0-3]):[0-5]\d$`, threshold integer 0–100, `publicBaseUrl` a URL, initial one character. Persist every field except the token.

`saveInstagramToken` requires `settings.write`. Trim the token. If either id or token is empty, set all three ig columns and `connected_at` to null. Otherwise store them and `connected_at = now()`. `getSettings` selects brand plus `ig_connection.username` only.

Brain page: two panes. Left, the doc list with title and `diubah {relative}`. Right, a textarea of the body and `Simpan`. A `catatan-baru` row at the bottom opens a dialog (shadcn `Dialog`) with a title field and `Buat`. Locked docs have no delete icon. Unlocked docs have a delete button that asks the dialog `Hapus catatan ini?`. Viewers see the textarea `readOnly` and no save button. Relative time: under 1 minute `baru saja`, under 60 minutes `{n} mnt lalu`, under 24 hours `{n} jam lalu`, else `{n} hari lalu`. Put that helper in `src/domain/metrics.ts` as `relativeId(from: Date, now: Date): string`.

Pengaturan page, admin only; other roles redirect to `/overview`. Sections:

1. Brand fields bound to `getSettings`, button `Simpan`.
2. Instagram. If `igUsername` is set: `Terhubung sebagai @{username}` and `Putuskan`. If not: inputs `ID pengguna Instagram` and `Token akses`, button `Simpan koneksi`. Helper text: `Token tidak ditampilkan lagi setelah disimpan. Posting memakai API resmi Meta.`
3. Banners from env, not from the database: when `META_PROVIDER !== "meta"`, show `Mode latihan: posting tidak dikirim ke Instagram.` When `LLM_PROVIDER !== "openai"`, show `AI demo: skor dan naskah dibuat lokal, tanpa biaya.`

Server actions call the functions above and `revalidatePath`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/brain-settings.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/studio/brain.ts src/studio/settings.ts src/domain/metrics.ts app/\(studio\)/brain app/\(studio\)/pengaturan tests/brain-settings.test.ts
git commit -m "feat: add the brain vault and brand settings"
```

---

### Task 6: Job runner

**Files:**
- Create: `src/jobs/runner.ts`
- Create: `app/api/cron/route.ts`
- Test: `tests/jobs.test.ts`

**Interfaces:**
- Consumes: `Sql`, `isWithinWorkHours`
- Produces:
  - `type JobName = "scout.scan" | "analyst.score" | "copywriter.write" | "designer.render" | "publisher.publish" | "insights.sync"`
  - `enqueue(sql: Sql, job: { name: JobName; payload: Record<string, unknown>; runAt: Date; manual?: boolean }): Promise<void>`
  - `runDueJobs(sql: Sql, now: Date, deps: JobDeps): Promise<number>`
  - `type JobDeps = { handlers: Record<JobName, (ctx: JobCtx) => Promise<void>>; workStart: string; workEnd: string }`
  - `type JobCtx = { sql: Sql; payload: Record<string, unknown>; manual: boolean; now: Date }`

Auto jobs (`manual = false`) whose name is `scout.scan`, `analyst.score`, `copywriter.write`, or `designer.render` are pushed to the next `workStart` when `now` is outside hours. Their `runDueJobs` count does not include the push. `publisher.publish` and `insights.sync` always run. A handler error increments `attempts`, stores `error`, clears `locked_at`, and if `attempts < 3` sets `run_at = now + 5 minutes`. On the third failure `finished_at` is set. A thrown error does not stop the rest of the batch.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { enqueue, runDueJobs } from "../src/jobs/runner";

describe("jobs", () => {
  it("runs a due manual scout immediately and delays an auto scout at night", async () => {
    const sql = await createTestSql();
    const seen: string[] = [];
    const deps = {
      workStart: "07:00",
      workEnd: "22:00",
      handlers: {
        "scout.scan": async () => { seen.push("scout"); },
        "analyst.score": async () => {},
        "copywriter.write": async () => {},
        "designer.render": async () => {},
        "publisher.publish": async () => { seen.push("publish"); },
        "insights.sync": async () => {},
      },
    };
    const night = new Date("2026-10-27T16:00:00Z"); // 23:00 WIB
    await enqueue(sql, { name: "scout.scan", payload: {}, runAt: night, manual: true });
    await enqueue(sql, { name: "scout.scan", payload: { auto: true }, runAt: night, manual: false });
    await enqueue(sql, { name: "publisher.publish", payload: { id: "d1" }, runAt: night, manual: false });
    const ran = await runDueJobs(sql, night, deps);
    expect(ran).toBe(2);
    expect(seen).toEqual(["scout", "publish"]);
    const waiting = await sql.rows<{ finished_at: string | null }>(
      "select finished_at from jobs where payload->>'auto' = 'true'",
    );
    expect(waiting[0].finished_at).toBeNull();
  });

  it("retries a failed handler and finishes it on the third miss", async () => {
    const sql = await createTestSql();
    await enqueue(sql, { name: "insights.sync", payload: {}, runAt: new Date("2026-10-28T00:00:00Z") });
    const deps = {
      workStart: "07:00",
      workEnd: "22:00",
      handlers: {
        "scout.scan": async () => {},
        "analyst.score": async () => {},
        "copywriter.write": async () => {},
        "designer.render": async () => {},
        "publisher.publish": async () => {},
        "insights.sync": async () => { throw new Error("meta down"); },
      },
    };
    await runDueJobs(sql, new Date("2026-10-28T00:00:00Z"), deps);
    await runDueJobs(sql, new Date("2026-10-28T00:06:00Z"), deps);
    await runDueJobs(sql, new Date("2026-10-28T00:12:00Z"), deps);
    const row = await sql.rows<{ attempts: number; finished_at: string | null; error: string }>(
      "select attempts, finished_at, error from jobs",
    );
    expect(row[0].attempts).toBe(3);
    expect(row[0].finished_at).not.toBeNull();
    expect(row[0].error).toMatch(/meta down/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/jobs.test.ts`

Expected: FAIL with cannot find module `../src/jobs/runner`.

- [ ] **Step 3: Write the runner and the cron route**

`enqueue` inserts a uuid, the name, `JSON.stringify(payload)`, `runAt`, and `manual`.

`runDueJobs` loads up to 5 rows with `run_at <= now`, `finished_at is null`, and `locked_at is null`, ordered by `run_at`, inside a transaction that sets `locked_at = now` using `for update skip locked`. PGlite supports `for update`. After the transaction, for each claimed row:

- If the name is one of the four content jobs, `manual` is false, and `isWithinWorkHours(now, workStart, workEnd)` is false, set `locked_at = null` and `run_at` to the next Jakarta `workStart`. Compute that instant with `Intl.DateTimeFormat` parts for year/month/day in `Asia/Jakarta`, then add a day when today's start is already past. Do not increment the run count.
- Otherwise `await handlers[name]({ sql, payload, manual, now })`. On success set `finished_at = now` and `locked_at = null`. On failure follow the retry rule in the interface. Always clear `locked_at` in a `finally` if it is still set.

`app/api/cron/route.ts`: POST only. Compare `Authorization` to `Bearer ${process.env.CRON_SECRET}` with a length-safe equal (`timingSafeEqual` on the buffers). Mismatch returns 401. Load brand work hours (defaults `07:00` and `22:00` if no row). Call `runDueJobs` with the handlers from Task 7 onward. Until those handlers exist, pass the real handler map from `src/jobs/handlers.ts`, and in this task create that file exporting no-op async functions for all six names. Later tasks replace the function bodies in that same file. Return `{ ran }` as JSON.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/jobs.test.ts`

Expected: PASS, 2 tests. The night-time auto scout is still unfinished. The insights job is finished with attempts 3.

- [ ] **Step 5: Commit**

```bash
git add src/jobs app/api/cron tests/jobs.test.ts
git commit -m "feat: run due jobs with a work-hour gate and retries"
```

---

### Task 7: Sources, RSS, and Scout

**Files:**
- Create: `src/rss/parse.ts`
- Create: `src/rss/excerpt.ts`
- Create: `src/studio/sources.ts`
- Create: `app/(studio)/sumber/page.tsx`
- Create: `app/(studio)/sumber/actions.ts`
- Modify: `src/jobs/handlers.ts` (`scout.scan`)
- Test: `tests/scout.test.ts`

**Interfaces:**
- Consumes: `enqueue`, `Sql`, `can`, `SCOUT_INTERVAL_MS`
- Produces:
  - `type FeedItem = { title: string; url: string; publishedAt: Date | null; summary: string }`
  - `parseFeed(xml: string): FeedItem[]`
  - `excerptFromHtml(html: string): string` (visible text, tags and scripts stripped, collapsed whitespace, max 1200 chars)
  - `addSource(sql, role, input: { name: string; url: string; lang: "ID" | "EN" }): Promise<void>`
  - `setSourceEnabled(sql, role, id: string, enabled: boolean): Promise<void>`
  - `deleteSource(sql, role, id: string): Promise<void>`
  - `listSources(sql): Promise<SourceRow[]>` where `SourceRow` includes `topicCount`, `passCount7d`, `lastFetchedAt`, `lastError`
  - `runScout(ctx: JobCtx & { fetchFeed: (url: string) => Promise<string>; fetchPage: (url: string) => Promise<string> }): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/rss/parse";
import { excerptFromHtml } from "../src/rss/excerpt";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { addSource, listSources } from "../src/studio/sources";
import { runScout } from "../src/jobs/handlers";

const xml = `<?xml version="1.0"?><rss><channel>
  <item><title>Alat iklan baru</title><link>https://news.example/a</link>
    <pubDate>Wed, 28 Oct 2026 01:00:00 GMT</pubDate><description>Cuplikan.</description></item>
  <item><title>Duplikat</title><link>https://news.example/a</link><description></description></item>
</channel></rss>`;

describe("scout", () => {
  it("parses rss and ignores a second item with the same url", () => {
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Alat iklan baru", url: "https://news.example/a", summary: "Cuplikan." });
    expect(excerptFromHtml("<style>x</style><p>Halo <b>dunia</b></p><img src='https://news.example/a.jpg'>")).toBe(
      "Halo dunia",
    );
  });

  it("stores a topic, records an empty scan, and schedules the next one", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await addSource(sql, "admin", { name: "Contoh", url: "https://news.example/feed", lang: "ID" });
    await runScout({
      sql,
      payload: {},
      manual: true,
      now: new Date("2026-10-28T01:00:00Z"),
      fetchFeed: async () => xml,
      fetchPage: async () => "<article><p>Fakta dari sumber.</p><img src='https://cdn.example/secret.jpg'></article>",
    });
    const topics = await sql.rows<{ title: string; excerpt: string }>("select title, excerpt from topics");
    expect(topics).toEqual([{ title: "Alat iklan baru", excerpt: "Fakta dari sumber." }]);
    expect(JSON.stringify(topics)).not.toContain("secret.jpg");
    const activity = await sql.rows<{ message: string }>("select message from activity order by created_at");
    expect(activity.map((a) => a.message)).toContain("Menemukan 1 topik baru");
    await runScout({
      sql,
      payload: {},
      manual: true,
      now: new Date("2026-10-28T01:10:00Z"),
      fetchFeed: async () => xml,
      fetchPage: async () => "<p>Fakta dari sumber.</p>",
    });
    const again = await sql.rows<{ message: string }>("select message from activity order by created_at");
    expect(again.at(-1)?.message).toBe("Belum ada topik baru");
    const next = await sql.rows<{ name: string }>(
      "select name from jobs where finished_at is null and name = 'scout.scan'",
    );
    expect(next.length).toBeGreaterThan(0);
    const rows = await listSources(sql);
    expect(rows[0].topicCount).toBe(1);
    await expect(addSource(sql, "viewer", { name: "X", url: "https://x.example/feed", lang: "EN" })).rejects.toThrow(
      /forbidden/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/scout.test.ts`

Expected: FAIL with cannot find module `../src/rss/parse`.

- [ ] **Step 3: Write the parser, the source screen, and the scout handler**

`parseFeed` uses `fast-xml-parser` with `ignoreAttributes: false`. Accept RSS `channel.item` and Atom `feed.entry`. Title from `title`, URL from `link` (string or `@_href` or the first `link` whose `@_rel` is `alternate`), date from `pubDate` or `published` or `updated`, summary from `description` or `summary` or `content`, with tags stripped. Drop items with an empty title or a URL that does not parse. Deduplicate by URL inside one document, first wins.

`excerptFromHtml` removes `script`, `style`, and `noscript` blocks first, then tags, then collapses whitespace, then slices to 1200 characters. It must not keep `src=` values.

`addSource` / `setSourceEnabled` / `deleteSource` require `source.write`. Name 2–80 chars. URL must be `http:` or `https:`. `listSources` returns counts with two subqueries: all topics, and topics with `state = 'passed'` and `scored_at > now() - interval '7 days'`.

Sumber page: the form from the inspection (`Nama`, URL placeholder `https://contoh.com/feed`, language select, kind label `RSS/Atom` as static text, button `Tambah`). Each row: a switch, name, `ID` or `EN` badge, URL, the count line `{topicCount} topik / {passCount7d} lolos (7 hari)`, `dicek {relative}` or `belum pernah`, the error in `--bad` when present, and `Hapus` with a confirm dialog. Empty state: `Belum ada sumber. Tempel URL RSS untuk mulai.` A failed action returns the message under the form. Non-admins redirect to `/overview`.

`runScout`:

1. Select enabled sources.
2. For each, `fetchFeed`. On throw, set `last_error` to the message (max 300 chars) and continue.
3. Parse, insert topics that are not already present (`on conflict (url) do nothing`). Set `summary` from the feed and `excerpt` from `fetchPage`. If `fetchPage` throws, store an empty excerpt and do not fail the topic.
4. Clear `last_error`, set `last_fetched_at`.
5. Insert activity. One line for the whole scan: `Menemukan {n} topik baru` or `Belum ada topik baru`.
6. Enqueue `analyst.score` for each new topic id with `runAt = now` and `manual` copied from the scout job.
7. Enqueue the next `scout.scan` at `now + SCOUT_INTERVAL_MS`, `manual: false`, only if there is no unfinished `scout.scan` row.

The cron handler `scout.scan` reads `fetch` from the global and passes it as `fetchFeed` / `fetchPage` with an 8 second `AbortSignal.timeout`. Tests call `runScout` directly.

Button `Cari topik sekarang` on the overview (and later radar) enqueues `scout.scan` with `manual: true` and `runAt = now`. Add that server action in `app/(studio)/overview/actions.ts` now. It requires `review.write`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/scout.test.ts`

Expected: PASS. The excerpt contains `Fakta dari sumber.` and not the image URL. A viewer's `addSource` throws `forbidden`.

- [ ] **Step 5: Commit**

```bash
git add src/rss src/studio/sources.ts src/jobs/handlers.ts app/\(studio\)/sumber app/\(studio\)/overview/actions.ts tests/scout.test.ts
git commit -m "feat: ingest RSS sources with the scout job"
```

---

### Task 8: Analis and Radar Topik

**Files:**
- Create: `src/llm/provider.ts`
- Create: `src/agents/prompts.ts`
- Create: `src/agents/analyst.ts`
- Create: `src/studio/topics.ts`
- Create: `app/(studio)/radar/page.tsx`
- Create: `app/(studio)/radar/actions.ts`
- Modify: `src/jobs/handlers.ts` (`analyst.score`)
- Test: `tests/analyst.test.ts`

**Interfaces:**
- Consumes: `totalScore`, `verdict`, `PASS_THRESHOLD_DEFAULT`, `enqueue`, brain bodies, brand `pass_threshold`
- Produces:
  - `type LlmRequest = { purpose: "score" | "copy"; system: string; user: string }`
  - `type LlmResult = { text: string; costUsd: number; model: string }`
  - `interface LlmProvider { complete(req: LlmRequest): Promise<LlmResult> }`
  - `class ScriptedLlm` and `class DemoLlm` and `createLlm(): LlmProvider`
  - `scoreTopic(text: string): { aspects: AspectScores; tags: string[]; sensitive: boolean; sensitiveReason: string | null; blocked: boolean; reason: string }`
  - `listTopics(sql, query: { filter: Filter; sort: "new" | "score"; q: string }): Promise<TopicListItem[]>`
  - `type Filter = "passed" | "all" | "waiting" | "skipped" | "failed" | "drafted"`

`createLlm` returns `DemoLlm` unless `LLM_PROVIDER=openai`. `DemoLlm` hashes the user text. If it contains `FIXTURE:low`, aspects are all 8 (total 40). If it contains `FIXTURE:sensitive`, aspects are all 16 (total 80) and `sensitive` is true. Otherwise aspects are 16 each (total 80) and `sensitive` is false. `costUsd` is `0.002`, `model` is `demo`. Tags are `["marketing"]`. `blocked` is true only when the user text contains `LARANGAN KERAS`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { DemoLlm } from "../src/llm/provider";
import { scoreTopic } from "../src/agents/analyst";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { runAnalyst } from "../src/jobs/handlers";
import { listTopics } from "../src/studio/topics";

describe("analyst", () => {
  it("rejects a score that is not five integers", () => {
    expect(() => scoreTopic(JSON.stringify({ aspects: { relevansi: 80 }, tags: [], sensitive: false, blocked: false, reason: "" }))).toThrow();
  });

  it("passes a high score, flags sensitive, and skips a hard ban", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const source = "11111111-1111-1111-1111-111111111111";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [source, "Contoh", "https://news.example/feed", "ID"]);
    async function topic(id: string, title: string) {
      await sql.rows(
        "insert into topics (id, source_id, title, url, summary) values ($1,$2,$3,$4,$5)",
        [id, source, title, `https://news.example/${id}`, "cuplikan"],
      );
    }
    await topic("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "Biasa");
    await topic("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", "FIXTURE:low");
    await topic("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3", "FIXTURE:sensitive");
    const llm = new DemoLlm();
    await runAnalyst({ sql, payload: { topicId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1" }, manual: true, now: new Date(), llm });
    await runAnalyst({ sql, payload: { topicId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2" }, manual: true, now: new Date(), llm });
    await runAnalyst({ sql, payload: { topicId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3" }, manual: true, now: new Date(), llm });
    const passed = await listTopics(sql, { filter: "passed", sort: "score", q: "" });
    expect(passed.map((t) => t.title).sort()).toEqual(["Biasa", "FIXTURE:sensitive"]);
    expect(passed.find((t) => t.title === "FIXTURE:sensitive")?.sensitive).toBe(true);
    const skipped = await listTopics(sql, { filter: "skipped", sort: "new", q: "" });
    expect(skipped.map((t) => t.title)).toEqual(["FIXTURE:low"]);
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'analis'");
    expect(log.at(-1)?.message).toBe("Menilai 1 topik, 1 lolos ambang skor 70");
    const queued = await sql.rows<{ name: string }>("select name from jobs where name = 'copywriter.write'");
    expect(queued).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/analyst.test.ts`

Expected: FAIL with cannot find module `../src/llm/provider`.

- [ ] **Step 3: Write the provider, the scorer, and the radar**

`scoreTopic` parses JSON and validates with zod: five integer aspects 0–20, `tags` an array of 0–4 short strings, `sensitive` boolean, `sensitiveReason` string or null, `blocked` boolean, `reason` string max 280. Throw `Error("skor tidak valid")` otherwise. Export the zod schema as `scoreSchema`.

`src/agents/prompts.ts` exports `analystSystem(brain: string)` and `copySystem(brain: string)`. The analyst system says: read the brain, return only JSON matching the schema, do not include facts that are not in the excerpt, set `sensitive` from doc 04, set `blocked` only for a hard ban, score each aspect 0–20.

`runAnalyst`:

1. Load the topic, its source name, and all brain bodies concatenated with `## {title}` headings.
2. Call `llm.complete` with `purpose: "score"` and a user message that includes title, URL, source, published time, summary, and excerpt.
3. Insert an `llm_spend` row with the returned cost.
4. On invalid JSON, set the topic `state = 'failed'`, `error` to the message, activity `Gagal menilai "{title}"`, and return. Do not throw, so the job finishes.
5. On a valid score, store aspects, tags, sensitive, reason, `score`, `scored_at`. `state` is `skipped` when `blocked` or `verdict(score, threshold) === "dilewati"`. Otherwise `passed`.
6. Activity: `Menilai 1 topik, {0|1} lolos ambang skor {threshold}`.
7. When `passed`, enqueue `copywriter.write` with `{ topicId }` at `now`.

`OpenAiLlm` posts to `https://api.openai.com/v1/chat/completions` with `response_format: { type: "json_object" }`, model `process.env.OPENAI_MODEL ?? "gpt-4o-mini"`, bearer `OPENAI_API_KEY`. Cost is `(prompt_tokens * inputRate + completion_tokens * outputRate) / 1_000_000` using `OPENAI_INPUT_USD_PER_MTOK` (default `0.15`) and `OPENAI_OUTPUT_USD_PER_MTOK` (default `0.60`). If usage is missing, cost is 0.

Radar page. Kicker `SCOUT + ANALIS`, title `RADAR TOPIK`. Intro from the live screen: `Topik 3 hari terakhir yang belum dibuatkan konten, terbaru di atas. Ada yang dilewati padahal menurutmu bagus? Klik "Buatkan konten". Yang sudah jadi draft pindah ke Antrian Review.` The "3 hari" sentence is the helper text; the filter still decides the query, default filter `passed`, and `passed` is not date-limited. Buttons `Nilai 0 topik sekarang` (enqueues `analyst.score` with `{ rescoreWaiting: true }`, manual) and `Cari topik sekarang`. `runAnalyst` with `rescoreWaiting` loads up to 20 `state = 'new'` topics and scores each. Filters are links with search params `filter`, `sort`, `q`. A row shows the score in accent (or `–` when null), a `Lolos` or `Dilewati` badge, tags, source, relative time, title, and `Buatkan konten` when the role can `review.write` and the state is not `drafted`. Empty: `Belum ada topik. Tambah sumber atau cari sekarang.` `Buatkan konten` enqueues `copywriter.write` with `{ topicId, force: true }` even for `skipped`.

Search matches `title ilike '%' || q || '%'`. Sort `new` is `discovered_at desc`. Sort `score` is `score desc nulls last`.

Filter map: `passed` → `state = 'passed'`; `waiting` → `new`; `skipped` → `skipped`; `failed` → `failed`; `drafted` → `drafted`; `all` → no state clause.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/analyst.test.ts`

Expected: PASS. Two copywriter jobs (the normal pass and the sensitive pass). The low score is skipped and has no copy job.

- [ ] **Step 5: Commit**

```bash
git add src/llm src/agents src/studio/topics.ts src/jobs/handlers.ts app/\(studio\)/radar tests/analyst.test.ts
git commit -m "feat: score topics and list them on the radar"
```
---

### Task 9: Copywriter

**Files:**
- Create: `src/agents/copywriter.ts`
- Modify: `src/llm/provider.ts` (`DemoLlm` copy branch)
- Modify: `src/jobs/handlers.ts` (`runCopywriter`, `copywriter.write`)
- Test: `tests/copywriter.test.ts`

**Interfaces:**
- Consumes: `LlmProvider`, `enqueue`, brain bodies, brand `default_format` and `default_template`, `makeShortCode`
- Produces:
  - `type Slide = { role: "cover" | "point" | "cta"; kicker: string; headline: string; body: string }`
  - `type DraftCopy = { slides: Slide[]; caption: string; hashtags: string[]; altHeadlines: [string, string] }`
  - `parseCopy(text: string): DraftCopy`
  - `runCopywriter(ctx: JobCtx & { llm: LlmProvider }): Promise<void>`

`parseCopy` requires the first slide to be `cover`, the last to be `cta`, and every middle slide to be `point`. Middle length is 2–5. Headlines are 8–120 characters. Bodies are 1–280 characters. Caption is 20–500 characters and must contain the source name that the caller passes as `sourceName`. Hashtags are 3–8 strings matching `^[a-z0-9]+$/`. `altHeadlines` has length 2. Throw `Error("naskah tidak valid")` on any miss.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseCopy } from "../src/agents/copywriter";
import { DemoLlm } from "../src/llm/provider";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { runCopywriter } from "../src/jobs/handlers";

const good = {
  slides: [
    { role: "cover", kicker: "AI", headline: "Iklan baru bisa nyamar jadi fitur", body: "Satu kalimat pembuka." },
    { role: "point", kicker: "Fakta", headline: "Uji coba dibuka minggu ini", body: "Berlaku di beberapa akun." },
    { role: "point", kicker: "Dampak", headline: "Tim konten harus cek sumber", body: "Jangan bagikan ulang mentah." },
    { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Artikel asli ada di Contoh." },
  ],
  caption: "Ringkasan dari Contoh. Ini bukan artikel aslinya.",
  hashtags: ["iklan", "medsos", "sumber"],
  altHeadlines: ["Fitur baru, atau iklan?", "Cek dulu sebelum dibagikan"],
};

describe("copywriter", () => {
  it("rejects a carousel that forgets the source", () => {
    expect(() => parseCopy(JSON.stringify({ ...good, caption: "Tanpa nama media." }), "Contoh")).toThrow(
      /naskah tidak valid/,
    );
  });

  it("writes a draft and asks the designer to render it", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111", "Contoh", "https://news.example/feed", "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state, score) values ($1,$2,$3,$4,'passed',80)",
      ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "11111111-1111-1111-1111-111111111111", "Iklan baru", "https://news.example/a"],
    );
    await runCopywriter({
      sql,
      payload: { topicId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1" },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
      llm: new DemoLlm(),
    });
    const drafts = await sql.rows<{ status: string; format: string }>("select status, format from drafts");
    expect(drafts).toEqual([{ status: "drafted", format: "teaser_bio" }]);
    const jobs = await sql.rows<{ name: string }>("select name from jobs where name = 'designer.render'");
    expect(jobs).toHaveLength(1);
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'copywriter'");
    expect(log[0].message.startsWith("Draft siap:")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/copywriter.test.ts`

Expected: FAIL with cannot find module `../src/agents/copywriter`.

- [ ] **Step 3: Write the parser and the handler**

`parseCopy(text, sourceName)` JSON-parses, checks the shape above, and throws unless `caption.toLowerCase()` includes `sourceName.toLowerCase()`.

`DemoLlm.complete` for `purpose: "copy"` returns `costUsd: 0.01`, `model: "demo"`, and JSON built like `good`, with the headline taken from the line `Judul: ...` in the user message, the source name from the line `Sumber: ...`, and that source name placed in the caption and the CTA body. Keep the other slides as in `good` so the parser accepts them.

`runCopywriter`:

1. Load topic, source name, brain, brand defaults. If the topic is missing, throw. If `state` is `skipped` or `failed` and `payload.force` is not true, return without a draft.
2. Call the LLM. Insert `llm_spend` for agent `copywriter`.
3. `parseCopy`. On failure, set topic `state = 'failed'` and `error`, activity `Gagal menulis "{title}"`, and return.
4. Insert the draft with a new uuid, `status = 'drafted'`, brand format and template, `focal_y = 50`, slides JSON, and a unique `short_code` from `makeShortCode(crypto.randomBytes(5))`. On unique conflict, try again up to 5 times, then throw.
5. Set the topic `state = 'drafted'`.
6. Activity `Draft siap: "{cover headline}"`.
7. Enqueue `designer.render` with `{ draftId }` at `now`.

When `payload.rewrite` is true and a draft exists, update slides, caption, hashtags, and alt headlines, set `text_dirty = true`, leave `status` unchanged, and enqueue render. Do not mint a second draft.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/copywriter.test.ts`

Expected: PASS, 2 tests. The draft format is `teaser_bio` because that is the seed default.

- [ ] **Step 5: Commit**

```bash
git add src/agents/copywriter.ts src/llm/provider.ts src/jobs/handlers.ts tests/copywriter.test.ts
git commit -m "feat: turn a passed topic into slide JSON"
```

---

### Task 10: Slide templates and the designer

**Files:**
- Create: `src/render/html.ts`
- Create: `src/render/raster.ts`
- Create: `app/media/[id]/route.ts`
- Modify: `src/jobs/handlers.ts` (`runDesigner`)
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `SLIDE_WIDTH`, `SLIDE_HEIGHT`, `assertTransition`, draft slides
- Produces:
  - `renderSlideHtml(input: { template: "stabilo" | "foto_penuh" | "serif" | "catatan"; slide: Slide; index: number; total: number; handle: string; sourceName: string; accent: string; focalY: number; photoDataUrl: string | null }): string`
  - `interface Rasterizer { toPng(html: string): Promise<Uint8Array> }`
  - `class FakeRasterizer implements Rasterizer`
  - `class PlaywrightRasterizer implements Rasterizer`
  - `slidesForFormat(format: "carousel_full" | "teaser_bio", slides: Slide[]): Slide[]`
  - `runDesigner(ctx: JobCtx & { rasterizer: Rasterizer }): Promise<void>`

`slidesForFormat` returns `[cover, cta]` for `teaser_bio` and `[cover, ...points]` for `carousel_full`. It throws if that selection is shorter than 2 or longer than 10.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderSlideHtml, slidesForFormat } from "../src/render/html";
import { FakeRasterizer } from "../src/render/raster";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { runDesigner } from "../src/jobs/handlers";

const slides = [
  { role: "cover" as const, kicker: "AI", headline: "Iklan baru bisa nyamar", body: "Pembuka." },
  { role: "point" as const, kicker: "Fakta", headline: "Uji coba dibuka", body: "Detail." },
  { role: "point" as const, kicker: "Dampak", headline: "Cek sumbernya", body: "Jangan salin." },
  { role: "cta" as const, kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke artikel Contoh." },
];

describe("designer", () => {
  it("renders a 4:5 teaser without a remote image", () => {
    expect(slidesForFormat("teaser_bio", slides).map((s) => s.role)).toEqual(["cover", "cta"]);
    expect(slidesForFormat("carousel_full", slides)).toHaveLength(3);
    const html = renderSlideHtml({
      template: "serif",
      slide: slides[0],
      index: 0,
      total: 2,
      handle: "redaksi",
      sourceName: "Contoh",
      accent: "#d7ff3a",
      focalY: 50,
      photoDataUrl: null,
    });
    expect(html).toContain("1080");
    expect(html).toContain("1350");
    expect(html).toContain("Sumber: Contoh");
    expect(html).toContain("@redaksi");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("stores two pngs and moves the draft to review", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111", "Contoh", "https://news.example/feed", "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state) values ($1,$2,$3,$4,'drafted')",
      ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "11111111-1111-1111-1111-111111111111", "Iklan", "https://news.example/a"],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'drafted','teaser_bio','serif',$3::jsonb,'cap',$4::jsonb,$5::jsonb,'abcde')`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        JSON.stringify(slides),
        JSON.stringify(["iklan", "medsos", "sumber"]),
        JSON.stringify(["Alt satu cukup", "Alt dua cukup"]),
      ],
    );
    await runDesigner({
      sql,
      payload: { draftId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1" },
      manual: true,
      now: new Date(),
      rasterizer: new FakeRasterizer(),
    });
    const assets = await sql.rows("select slide_index from assets order by slide_index");
    expect(assets).toHaveLength(2);
    const status = await sql.rows<{ status: string; text_dirty: boolean }>("select status, text_dirty from drafts");
    expect(status[0]).toMatchObject({ status: "needs_review", text_dirty: false });
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'designer'");
    expect(log[0].message).toBe('Gambar selesai untuk "Iklan baru bisa nyamar"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/render.test.ts`

Expected: FAIL with cannot find module `../src/render/html`.

- [ ] **Step 3: Write the templates, the rasterizers, and the media route**

`renderSlideHtml` returns a complete `<!doctype html>` document. The root is a `section` of `1080px` by `1350px` with `overflow: hidden`. Fonts are `Impact, sans-serif` for headlines and `Georgia, serif` for body. No `<link>` and no `http` URLs. Paint a geometric cover from the headline hash: four rectangles whose fills are the accent mixed with `#14171c`, `#f6ee5f`, and white. Layouts:

- `stabilo`: background is the accent, text `#0d0d0d`, headline about 72px, kicker on top, `Sumber:` and `@handle` in the footer, page `index+1/total` at the top right.
- `serif`: top 52% white with the kicker, headline, and body; bottom 48% is the geometric cover (or the uploaded photo). Footer on the white area includes `Sumber:`.
- `foto_penuh`: cover fills the slide, a black scrim at the bottom holds the headline and `Sumber:`.
- `catatan`: background `#f4efe4`, a `#f6ee5f` sticky note contains the kicker, the headline sits below it, `Sumber:` in the footer.

When `photoDataUrl` is a `data:image/` string, the cover `<img>` uses it and `object-position: center {focalY}%`. Otherwise there is no `<img>`.

`FakeRasterizer.toPng` returns `Uint8Array.from(Buffer.from("PNG" + html.length))`. `PlaywrightRasterizer.toPng` launches Chromium once, sets the viewport to 1080×1350, `setContent(html, { waitUntil: "load" })`, and returns a PNG screenshot. The cron path uses Playwright. Tests use `FakeRasterizer`.

`runDesigner` loads the draft, topic, source name, and brand. It deletes existing assets for the draft, renders each selected slide, and inserts `(id, draft_id, slide_index, bytes)`. Then `assertTransition("worker", current, "needs_review")` only when `current === "drafted"`. From `needs_review` a re-render stays in `needs_review`. Set `text_dirty = false` and `updated_at = now()`. Activity uses the cover headline. On a rasterizer throw, store `drafts.error` and rethrow so the runner retries.

`app/media/[id]/route.ts` selects the asset only when the parent draft `status in ('posting','posted')`. Otherwise 404. Response `content-type: image/png` and `cache-control: public, max-age=86400`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/render.test.ts`

Expected: PASS, 2 tests. HTML contains `Sumber: Contoh` and no `http`.

- [ ] **Step 5: Commit**

```bash
git add src/render app/media src/jobs/handlers.ts tests/render.test.ts
git commit -m "feat: render carousel slides to PNG"
```

---

### Task 11: Antrian Review and the editor

**Files:**
- Create: `src/studio/drafts.ts`
- Create: `app/(studio)/review/page.tsx`
- Create: `app/(studio)/review/[id]/page.tsx`
- Create: `app/(studio)/review/actions.ts`
- Test: `tests/review.test.ts`

**Interfaces:**
- Consumes: `assertTransition`, `can`, `enqueue`, `runCopywriter` via a queued job (the action only enqueues)
- Produces:
  - `listDrafts(sql, status: DraftStatus): Promise<DraftCard[]>`
  - `saveDraftText(sql, role, id, input: { slides: Slide[]; caption: string; hashtags: string[]; altHeadlines: [string, string]; kicker: string }): Promise<void>`
  - `saveFocal(sql, role, id, focalY: number): Promise<void>`
  - `setFormat(sql, role, id, format: "carousel_full" | "teaser_bio"): Promise<void>`
  - `setTemplate(sql, role, id, template: "stabilo" | "foto_penuh" | "serif" | "catatan"): Promise<void>`
  - `approveDraft(sql, role, id): Promise<void>`
  - `scheduleDraft(sql, role, id, scheduledAt: Date): Promise<void>`
  - `postDraftNow(sql, role, id): Promise<void>`
  - `markPostedManually(sql, role, id): Promise<void>`
  - `rejectDraft(sql, role, id): Promise<void>`
  - `deleteDraft(sql, role, id): Promise<void>`
  - `retryFailed(sql, role, id): Promise<void>`

Write actions require `review.write` except `approveDraft`, `scheduleDraft`, `postDraftNow`, `markPostedManually`, and `retryFailed`, which require `publish`. A viewer gets `forbidden`. `approveDraft` and `scheduleDraft` and `postDraftNow` throw `Error("Render dulu teks yang baru")` when `text_dirty` is true.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { approveDraft, listDrafts, markPostedManually, postDraftNow, saveDraftText } from "../src/studio/drafts";

async function seedDraft(sql: Awaited<ReturnType<typeof createTestSql>>, dirty: boolean) {
  await seedDefaults(sql);
  await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
    "11111111-1111-1111-1111-111111111111", "Contoh", "https://news.example/feed", "ID",
  ]);
  await sql.rows("insert into topics (id, source_id, title, url, state, score, sensitive) values ($1,$2,$3,$4,'drafted',84,true)", [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "11111111-1111-1111-1111-111111111111", "Iklan", "https://news.example/a",
  ]);
  await sql.rows(
    `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, text_dirty)
     values ($1,$2,'needs_review','teaser_bio','serif','[]'::jsonb,'cap','[]'::jsonb,'[]'::jsonb,'abcde',$3)`,
    ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", dirty],
  );
}

describe("review", () => {
  it("blocks approval after an edit until the slide is rendered again", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await saveDraftText(sql, "social_media", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", {
      slides: [{ role: "cover", kicker: "AI", headline: "Judul baru yang cukup", body: "Isi." }],
      caption: "Dari Contoh.",
      hashtags: ["iklan", "medsos", "sumber"],
      altHeadlines: ["Alt satu cukup", "Alt dua cukup"],
      kicker: "AI",
    });
    await expect(approveDraft(sql, "social_media", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1")).rejects.toThrow(
      /Render dulu/,
    );
    await expect(postDraftNow(sql, "viewer", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1")).rejects.toThrow(/forbidden/);
  });

  it("lets a human mark a clean draft as posted without calling Meta", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await markPostedManually(sql, "admin", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1");
    const rows = await listDrafts(sql, "posted");
    expect(rows[0]).toMatchObject({ manual: true, sensitive: true, sourceName: "Contoh" });
    const jobs = await sql.rows("select id from jobs where name = 'publisher.publish'");
    expect(jobs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/review.test.ts`

Expected: FAIL with cannot find module `../src/studio/drafts`.

- [ ] **Step 3: Write the mutations and both screens**

Every mutation loads the draft and calls `assertTransition("human", from, to, manual)` before the update. `saveDraftText` does not change status; it sets `text_dirty = true` and replaces slides, caption, hashtags, and alt headlines. `saveFocal` clamps 0–100 and sets `text_dirty = true`. `setFormat` and `setTemplate` also set `text_dirty = true`.

`approveDraft`: `needs_review → approved`. `scheduleDraft`: from `needs_review` or `approved` to `scheduled`, `scheduled_at` must be in the future, and it enqueues `publisher.publish` with `{ draftId }` and `runAt = scheduledAt`. `postDraftNow`: if the status is `needs_review`, first update to `approved`, then to `posting`, then enqueue the publisher at `now` with `manual: true`. `markPostedManually`: to `posted` with `manual = true`, `posted_at = now()`, no job. `rejectDraft`: to `rejected`. `deleteDraft`: allowed from any status except `posting`; delete the draft and set the topic back to `passed`. `retryFailed`: `failed → posting`, clear `error`, enqueue the publisher.

`listDrafts` joins topics and sources and returns id, status, format, template, score, sensitive, headline (first slide), sourceName, shortCode, clickCount, updatedAt, manual, and the first asset id when one exists.

Review index. Kicker `MEJA EDITOR`, title `ANTRIAN REVIEW`, the intro sentence from the inspection. Tabs are links `?status=` with counts. Default `needs_review`. `Pilih beberapa` is a client toggle. When it is on, each card has a checkbox and a sticky bar offers `Setujui`, `Jadwalkan` (one datetime-local, interpreted as WIB by appending `+07:00` before `new Date`), and `Tolak`. Cards link to `/review/{id}` and show the cover image from `/media/{assetId}` only when the status is already `posted` or `posting`; otherwise use an `<img>` whose `src` is a studio-only route `app/(studio)/review/[id]/slide/[index]/route.ts` that requires a session and returns the PNG. Add that route in this task. Show `1/{n}` from `slidesForFormat`, the handle, the score, `Cek risiko` when sensitive, the headline, the source, and the relative time. Empty tab: `Tidak ada draf di tab ini.`

Editor page. Back link `Antrian review`. Two preview tabs: `Hasil render` shows the slide images and arrow buttons; `Atur posisi foto` shows a range input 0–100 bound to `saveFocal` and a file input `Ganti gambar` that accepts `image/png` or `image/jpeg` up to 2 MB, stores it as a data URL on the cover slide under `photoDataUrl`, and sets `text_dirty`. Do not fetch a URL from the user. Right column: status, the short link, click count, the action buttons from the inspection, the WIB datetime, template choices, format choices with the helper `Slide isi di bawah tetap disimpan, tapi yang diposting cuma cover + slide baca di link bio.` for teaser, headline, the two alternates as buttons that copy that text into the headline field, `Simpan & render ulang` (saves then enqueues `designer.render`), and `Simpan teks saja`. When `text_dirty`, the approve, schedule, and post buttons are disabled and the note `Render dulu teks yang baru` is visible. `Tulis ulang` enqueues `copywriter.write` with `{ topicId, rewrite: true, force: true }`. `Copy caption + hashtag` is a client button that writes `caption + "\n\n" + hashtags mapped with #` to the clipboard and switches its label to `Tersalin` for 1.6 seconds. Downloads hit the session-protected slide route.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/review.test.ts`

Expected: PASS, 2 tests. Manual posting creates no publisher job.

- [ ] **Step 5: Commit**

```bash
git add src/studio/drafts.ts app/\(studio\)/review tests/review.test.ts
git commit -m "feat: add the review queue and the draft editor"
```

---

### Task 12: Calendar, human-scheduled publish, and Meta

**Files:**
- Create: `src/publish/publisher.ts`
- Create: `src/studio/calendar.ts`
- Create: `app/(studio)/kalender/page.tsx`
- Modify: `src/jobs/handlers.ts` (`runPublisher`)
- Test: `tests/publish.test.ts`

**Interfaces:**
- Consumes: `assertTransition`, draft status, `GRAPH_BASE`, `GRAPH_VERSION`
- Produces:
  - `type PublishInput = { igUserId: string; accessToken: string; imageUrls: string[]; caption: string; altTexts: string[]; shareToStory: boolean }`
  - `type PublishResult = { mediaId: string; storyMediaId: string | null; storyError: string | null }`
  - `interface Publisher { publish(input: PublishInput): Promise<PublishResult> }`
  - `class FakePublisher implements Publisher`
  - `class MetaPublisher implements Publisher` with constructor `(fetchImpl: typeof fetch)`
  - `runPublisher(ctx: JobCtx & { publisher: Publisher }): Promise<void>`
  - `weekItems(sql, weekStart: Date): Promise<{ id: string; title: string; at: Date; status: "scheduled" | "posted" }[]>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { FakePublisher, MetaPublisher } from "../src/publish/publisher";
import { createTestSql } from "../src/db/client";
import { runPublisher } from "../src/jobs/handlers";
import { weekItems } from "../src/studio/calendar";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("publisher", () => {
  it("stops when the Instagram quota is used up", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("content_publishing_limit")) {
        return json({ data: [{ quota_usage: 100, config: { quota_total: 100 } }] });
      }
      return json({ id: "should-not-publish" });
    };
    const meta = new MetaPublisher(fetchImpl);
    await expect(
      meta.publish({
        igUserId: "1789",
        accessToken: "token",
        imageUrls: ["https://studio.example/media/1", "https://studio.example/media/2"],
        caption: "Dari Contoh",
        altTexts: ["satu", "dua"],
        shareToStory: false,
      }),
    ).rejects.toThrow(/Kuota posting/);
    expect(calls.some((url) => url.includes("/media_publish"))).toBe(false);
  });

  it("publishes a scheduled draft through the fake adapter", async () => {
    const sql = await createTestSql();
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111", "Contoh", "https://news.example/feed", "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "11111111-1111-1111-1111-111111111111", "Iklan", "https://news.example/a",
    ]);
    await sql.rows(
      "insert into ig_connection (id, ig_user_id, access_token, username) values (1,$1,$2,$3) on conflict (id) do update set ig_user_id = $1, access_token = $2, username = $3",
      ["1789", "token", "redaksi"],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, scheduled_at)
       values ($1,$2,'scheduled','teaser_bio','serif',$3::jsonb,'Dari Contoh','["a","b","c"]'::jsonb,'["Alt satu cukup","Alt dua cukup"]'::jsonb,'abcde',$4)`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        JSON.stringify([
          { role: "cover", kicker: "AI", headline: "Iklan baru bisa nyamar", body: "Pembuka." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
        "2026-10-28T02:00:00Z",
      ],
    );
    await sql.rows("insert into assets (id, draft_id, slide_index, bytes) values ($1,$2,0,$3),($4,$2,1,$3)", [
      "cccccccc-cccc-cccc-cccc-ccccccccccc1",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
      Buffer.from("png"),
      "cccccccc-cccc-cccc-cccc-ccccccccccc2",
    ]);
    await runPublisher({
      sql,
      payload: { draftId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1" },
      manual: false,
      now: new Date("2026-10-28T02:00:00Z"),
      publisher: new FakePublisher(),
    });
    const row = await sql.rows<{ status: string; ig_media_id: string }>("select status, ig_media_id from drafts");
    expect(row[0].status).toBe("posted");
    expect(row[0].ig_media_id.startsWith("fake_")).toBe(true);
    const items = await weekItems(sql, new Date("2026-10-26T00:00:00Z"));
    expect(items).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/publish.test.ts`

Expected: FAIL with cannot find module `../src/publish/publisher`.

- [ ] **Step 3: Write the publishers, the handler, and the week grid**

`FakePublisher` pushes the input onto a public `calls` array and returns `{ mediaId: "fake_" + calls.length, storyMediaId: input.shareToStory ? "fake_story" : null, storyError: null }`.

`MetaPublisher.publish`:

1. `GET {GRAPH_BASE}/{GRAPH_VERSION}/{igUserId}/content_publishing_limit?access_token=...`
2. Read `data[0].quota_usage` and `data[0].config.quota_total`. When both are numbers and usage is greater than or equal to total, throw `Error("Kuota posting API Instagram hari ini habis")`. When the body is not that shape, continue.
3. For each image, `POST .../{igUserId}/media` with JSON `{ image_url, is_carousel_item: true, alt_text }`. Collect ids.
4. `poll(id)` does `GET .../{id}?fields=status_code` up to 5 times, 2 seconds apart. `FINISHED` returns. `ERROR` or `EXPIRED` throws `Error("Kontainer Instagram {status}")`. After 5 `IN_PROGRESS` results, throw `Error("Kontainer Instagram belum siap")`.
5. `POST` the parent `{ media_type: "CAROUSEL", children: ids.join(","), caption }`, poll it, then `POST .../{igUserId}/media_publish` with `{ creation_id }`.
6. When `shareToStory`, `POST` `{ media_type: "STORIES", image_url: imageUrls[0] }`, poll, and publish. On any story error, return the feed `mediaId` with `storyError` set to the message. Do not throw after the feed post succeeded.

`runPublisher` loads the draft, topic URL, source name, brand `public_base_url`, and `ig_connection`. When the brand row is missing, use `http://127.0.0.1:43123`. Image URLs are `{publicBaseUrl}/media/{assetId}` in `slide_index` order. Caption is the draft caption plus a blank line and the hashtags with `#`.

- Status `posted` or `failed`: return.
- Status `scheduled`: `assertTransition("worker", "scheduled", "posting")`, set `posting`, then continue.
- Status `posting`: continue.
- Any other status: throw `Error("publish requires human approval")`.
- When `process.env.META_PROVIDER === "meta"` and the token is null, set `failed` via `assertTransition("worker", "posting", "failed")`, store `Instagram belum terhubung`, and return.
- Otherwise call `publisher.publish`. On success set `posted`, `ig_media_id`, `story_media_id`, `story_error`, `posted_at`. On throw set `failed` and `error`.

The cron wires `MetaPublisher` when `META_PROVIDER=meta`, otherwise `FakePublisher`.

`weekItems` returns one row per draft. Use `posted_at` when the status is `posted`; otherwise use `scheduled_at`. Keep the row when that instant falls in the seven days starting at `weekStart`. The page takes `?week=YYYY-MM-DD` and computes the Monday of that week in `Asia/Jakarta`. Seven columns labeled `Sen Sel Rab Kam Jum Sab Min`. A block shows the time and title. Links go to `/review/{id}`. Empty week: `Belum ada yang dijadwalkan.` Prev/next links change the query. This layout is INFERRED; there was no public screenshot of Kalender.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/publish.test.ts`

Expected: PASS, 2 tests. The quota test never calls `media_publish`. The scheduled draft ends `posted` with a `fake_` id.

- [ ] **Step 5: Commit**

```bash
git add src/publish src/studio/calendar.ts src/jobs/handlers.ts app/\(studio\)/kalender tests/publish.test.ts
git commit -m "feat: publish scheduled carousels through the Meta API"
```

---

### Task 13: Insights and Analitik

**Files:**
- Create: `src/studio/analytics.ts`
- Create: `app/(studio)/analitik/page.tsx`
- Create: `app/(studio)/analitik/actions.ts`
- Modify: `src/jobs/handlers.ts` (`runInsights`)
- Test: `tests/analytics.test.ts`

**Interfaces:**
- Consumes: `engagementRate`, `deltaPct`, `INSIGHTS_INTERVAL_MS`
- Produces:
  - `type DailyPoint = { date: string; views: number; reach: number; followers: number }`
  - `normalizeInsights(input: { followers: number; daily: DailyPoint[]; accountsEngaged: number | null; posts: { igMediaId: string; views: number; reach: number; likes: number; comments: number; saves: number; shares: number }[] }): { snapshot: {...}; posts: ... }`
  - `analyticsView(sql, days: 7 | 28 | 90, now: Date): Promise<AnalyticsView>`
  - `runInsights(ctx: JobCtx & { fetchImpl: typeof fetch }): Promise<void>`

`AnalyticsView` includes the five cards, each `{ value: number | null; delta: number | null; deltaKind: "absolute" | "percent" }`, `daily` for the chart, and `posts` with `er`. Followers use `deltaKind: "absolute"`. Views, reach, and interactions use `percent`. `accountsEngaged` is null when the API omitted it. No snapshot returns `empty: true`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { analyticsView } from "../src/studio/analytics";
import { runInsights } from "../src/jobs/handlers";

describe("analytics", () => {
  it("does not invent numbers when Instagram is disconnected", async () => {
    const sql = await createTestSql();
    await runInsights({ sql, payload: {}, manual: true, now: new Date("2026-10-28T02:00:00Z"), fetchImpl: fetch });
    const view = await analyticsView(sql, 28, new Date("2026-10-28T02:00:00Z"));
    expect(view.empty).toBe(true);
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'analitik'");
    expect(log[0].message).toBe("Analitik dilewati: Instagram belum terhubung");
  });

  it("computes a follower delta in people and a views delta in percent", async () => {
    const sql = await createTestSql();
    const daily = [
      { date: "2026-10-01", views: 100, reach: 80, followers: 1000 },
      { date: "2026-10-20", views: 200, reach: 150, followers: 900 },
    ];
    await sql.rows(
      `insert into insight_snapshots (id, taken_at, followers, views, reach, interactions, accounts_engaged, daily)
       values ($1,$2,900,300,230,10,4,$3::jsonb)`,
      ["dddddddd-dddd-dddd-dddd-ddddddddddd1", "2026-10-28T00:00:00Z", JSON.stringify(daily)],
    );
    const view = await analyticsView(sql, 28, new Date("2026-10-28T02:00:00Z"));
    expect(view.empty).toBe(false);
    expect(view.followers.deltaKind).toBe("absolute");
    expect(view.views.deltaKind).toBe("percent");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/analytics.test.ts`

Expected: FAIL with cannot find module `../src/studio/analytics`.

- [ ] **Step 3: Write the sync and the page**

`runInsights` reads `ig_connection`. No token: write the activity line and still enqueue the next `insights.sync` at `now + INSIGHTS_INTERVAL_MS` when none is unfinished. With a token, request:

- `GET /{ig-user-id}?fields=followers_count`
- `GET /{ig-user-id}/insights?metric=views,reach&period=day&since={now-90d unix}&until={now unix}`
- `GET /{ig-user-id}/media?fields=id,timestamp,like_count,comments_count,media_type,insights.metric(views,reach,saved,shares)&limit=50`

If a metric returns an error object, skip that metric and set the matching number to 0, except `accounts_engaged`, which stays null. This plan does not request `accounts_engaged` from the API because the metric name is account-dependent; the card shows `–` until a later change adds a confirmed metric. Store interactions as `likes + comments + saves + shares` across the returned posts. Insert one `insight_snapshots` row. Upsert `post_insights` by matching `drafts.ig_media_id`. Ignore media ids that are not in `drafts`. Then enqueue the next sync.

`analyticsView` uses the latest snapshot. Slice `daily` to the last `days` dates and to the preceding window of the same length. Followers value is the snapshot `followers`. Followers delta is the last point's `followers` minus the last point of the previous window, an absolute number. Views and reach deltas use `deltaPct` on the sums. Interactions use the snapshot `interactions` as the value and `deltaPct` only when a previous snapshot exists inside the previous window; otherwise the delta is null. Posts join `post_insights` to drafts and topics, compute `engagementRate`, and sort by `posted_at desc` by default. The page's sort links (`Terbaru`, `Views`, `Reach`, `Likes`, `Komentar`, `Saves`, `Shares`, `ER`) pass `sort` and `analyticsView` orders accordingly.

Page. Kicker `INSTAGRAM · @{handle}`, title `ANALITIK`. Range links `7 hari`, `28 hari`, `90 hari`. Button `Sinkronkan sekarang` enqueues a manual `insights.sync` and requires `review.write`. Empty state: `Hubungkan Instagram di Pengaturan. Angka di sini hanya dari API resmi.` Cards use green `#34d399` for a positive delta and red `#f87171` for a negative one. Followers render the sign and the absolute number (`−774`), the others render `+6.535%` with `id-ID` separators. `Views harian` is an inline bar SVG. `Pertumbuhan followers` is an inline polyline. `Lihat tabel harian` is a `<details>` table. The post table shows a thumbnail, title, date, format, and the metric columns. This screen was public in the deck; match those labels.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/analytics.test.ts`

Expected: PASS, 2 tests. The disconnected run leaves `empty: true` and does not insert a snapshot.

- [ ] **Step 5: Commit**

```bash
git add src/studio/analytics.ts src/jobs/handlers.ts app/\(studio\)/analitik tests/analytics.test.ts
git commit -m "feat: sync Instagram insights into the analytics screen"
```

---

### Task 14: Bio page, short links, and the overview agents

**Files:**
- Create: `src/studio/bio.ts`
- Create: `app/baca/page.tsx`
- Create: `app/s/[code]/route.ts`
- Modify: `app/(studio)/overview/page.tsx`
- Modify: `src/studio/overview.ts`
- Test: `tests/bio.test.ts`

**Interfaces:**
- Consumes: `makeShortCode` already stored on the draft, `greeting`, `Funnel`
- Produces:
  - `bioGrid(sql): Promise<{ handle: string; initial: string; items: { code: string; sourceName: string; title: string; assetId: string }[] }>`
  - `resolveShortLink(sql, code: string, prefetch: boolean): Promise<{ location: string; counted: boolean } | null>`
  - `agentCards(sql, now: Date): Promise<{ agent: "scout" | "analis" | "copywriter" | "designer"; role: string; lastAt: Date | null; running: boolean }[]>`
  - `recentActivity(sql): Promise<{ agent: string; message: string; at: Date }[]>`

`bioGrid` returns posted drafts whose format is `teaser_bio`, newest `posted_at` first, at most 60. `resolveShortLink` returns null for an unknown code. It increments `click_count` only when `prefetch` is false.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { bioGrid, resolveShortLink } from "../src/studio/bio";
import { agentCards } from "../src/studio/overview";

describe("bio", () => {
  it("counts a real visit once and ignores a prefetch", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111", "Contoh", "https://news.example/feed", "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "11111111-1111-1111-1111-111111111111", "Iklan", "https://news.example/artikel",
    ]);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, posted_at)
       values ($1,$2,'posted','teaser_bio','serif','[{"role":"cover","kicker":"AI","headline":"Iklan baru bisa nyamar","body":"x"}]'::jsonb,'c','[]'::jsonb,'[]'::jsonb,'abcde', now())`,
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"],
    );
    await sql.rows("insert into assets (id, draft_id, slide_index, bytes) values ($1,$2,0,$3)", [
      "cccccccc-cccc-cccc-cccc-ccccccccccc1", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", Buffer.from("png"),
    ]);
    const grid = await bioGrid(sql);
    expect(grid.handle).toBe("redaksi");
    expect(grid.items[0]).toMatchObject({ code: "abcde", sourceName: "Contoh" });
    const prefetch = await resolveShortLink(sql, "abcde", true);
    const real = await resolveShortLink(sql, "abcde", false);
    expect(prefetch).toMatchObject({ location: "https://news.example/artikel", counted: false });
    expect(real).toMatchObject({ counted: true });
    const clicks = await sql.rows<{ click_count: number }>("select click_count from drafts");
    expect(clicks[0].click_count).toBe(1);
    expect(await resolveShortLink(sql, "tidak", false)).toBeNull();
  });

  it("marks an agent running when its job is locked", async () => {
    const sql = await createTestSql();
    await sql.rows(
      "insert into jobs (id, name, payload, run_at, locked_at) values ($1,'scout.scan','{}'::jsonb, now(), now())",
      ["eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1"],
    );
    const cards = await agentCards(sql, new Date());
    expect(cards.find((c) => c.agent === "scout")).toMatchObject({ running: true, role: "Pemantau topik" });
    expect(cards.find((c) => c.agent === "analis")?.role).toBe("Cek potensi viral");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/bio.test.ts`

Expected: FAIL with cannot find module `../src/studio/bio`.

- [ ] **Step 3: Write the public pages and finish the overview**

`app/s/[code]/route.ts` treats the request as a prefetch when any of these headers is present: `next-router-prefetch: 1`, `purpose: prefetch`, `sec-purpose` containing `prefetch`. It calls `resolveShortLink`. Null returns a 404 page body `Tautan tidak ditemukan.` A hit returns `302` with `location` and `vary: next-router-prefetch, purpose, sec-purpose`.

`app/baca/page.tsx` is public and uses the light tokens. Header disc shows `initial` on `#f6ee5f`. Title `@${handle}`. The instruction sentence and the footer sentences are the ones in the inspection, with the handle interpolated. The grid is 3 columns, gap `3px`, tiles `aspect-[4/5]`. Each tile links to `/s/{code}`, has an accessible name `{title}, baca di {sourceName}`, shows the first asset through a public route, and prints the source name on a bottom scrim. Posted teaser covers must be readable here, so extend `app/media/[id]/route.ts`: allow the asset when the draft is `posted` and `format = 'teaser_bio'` as well as `posting`. Empty grid: `Belum ada artikel.`

Overview page, under the four funnel cards, renders four agent cards in this order, with these roles and colors: Scout `Pemantau topik` `#38bdf8`, Analis `Cek potensi viral` `#a78bfa`, Copywriter `Headline & caption` `#fbbf24`, Designer `Render gambar` `#f472b6`. Subline `Lagi jalan` when `running`, otherwise `Standby · aktif {relative}` or `Belum pernah jalan`. Below that, `Aktivitas Redaksi` and `update otomatis`, listing `recentActivity` (latest 8). Greeting uses `greeting(now)` and the signed-in name, uppercased in the kicker: `SELAMAT PAGI, ADE`. The work-hours chip reads `AI aktif · jam kerja 07:00–22:00 WIB` inside the window and `AI tidur · jam kerja 07:00–22:00 WIB` outside it. `Mode: Semi-otomatis` is always shown. `Cari topik sekarang` is the action from Task 7.

`agentCards` sets `running` when a `jobs` row with that name prefix (`scout` → `scout.scan`, and so on) has `locked_at` not null and `finished_at` null. `lastAt` is the newest `activity.created_at` for that agent. Map the designer and copywriter names directly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/bio.test.ts`

Expected: PASS, 2 tests. Click count stays 1 after one prefetch and one real visit.

- [ ] **Step 5: Commit**

```bash
git add src/studio/bio.ts src/studio/overview.ts app/baca app/s app/media app/\(studio\)/overview tests/bio.test.ts
git commit -m "feat: add the bio grid, short links, and the newsroom overview"
```

---

### Task 15: Team invites

**Files:**
- Create: `src/studio/team.ts`
- Create: `app/(studio)/tim/page.tsx`
- Create: `app/(studio)/tim/actions.ts`
- Test: `tests/team.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `can`, `Role`
- Produces: `inviteUser(sql, actorRole: Role, input: { name: string; email: string; role: Role }): Promise<{ password: string }>`
- Produces: `listUsers(sql): Promise<{ name: string; email: string; role: Role; lastLoginAt: Date | null }[]>`

The returned password is 16 characters from the short-code alphabet. It is not stored in the clear. A duplicate email throws `Error("Email sudah dipakai")`. A non-admin throws `forbidden`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { verifyPassword } from "../src/auth/password";
import { inviteUser, listUsers } from "../src/studio/team";

describe("team", () => {
  it("creates a social media user and shows the password only once", async () => {
    const sql = await createTestSql();
    const created = await inviteUser(sql, "admin", {
      name: "Sari",
      email: "sari@redaksi.local",
      role: "social_media",
    });
    expect(created.password).toHaveLength(16);
    const users = await listUsers(sql);
    expect(users[0]).toMatchObject({ email: "sari@redaksi.local", role: "social_media" });
    expect(JSON.stringify(users)).not.toContain(created.password);
    const stored = await sql.rows<{ password_hash: string }>("select password_hash from users");
    expect(await verifyPassword(created.password, stored[0].password_hash)).toBe(true);
    await expect(
      inviteUser(sql, "social_media", { name: "X", email: "x@redaksi.local", role: "viewer" }),
    ).rejects.toThrow(/forbidden/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/team.test.ts`

Expected: FAIL with cannot find module `../src/studio/team`.

- [ ] **Step 3: Write the invite and the page**

`inviteUser` checks `team.write`, lowercases the email, rejects an invalid email, inserts the user, and returns the password. `listUsers` orders by `created_at`.

The page is admin-only. Form: `Nama`, `email@contoh.com`, role select (`Admin`, `Social Media`, `Viewer`, `KOL Specialist`), button `Buat akun`. After success, a dialog shows `Password sementara` and the password, with `Salin`. The list shows name, role, email, and `login terakhir baru saja` or `belum pernah login`. The matrix is four lines:

- Admin: `Semua akses, termasuk sumber topik, tim, dan pengaturan.`
- Social Media: `Review, edit, setujui, dan jadwalkan post. Edit Brain.`
- Viewer: `Hanya melihat.`
- KOL Specialist: `Hanya melihat. Ruang KOL belum dibuat.`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/team.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/studio/team.ts app/\(studio\)/tim tests/team.test.ts
git commit -m "feat: let an admin invite the newsroom team"
```

---

### Task 16: Marketing site, deck, Docker, and the runbook

**Files:**
- Create: `src/marketing/content.ts`
- Create: `app/(marketing)/page.tsx`
- Create: `app/(marketing)/presentasi/page.tsx`
- Create: `components/marketing/calculator.tsx`
- Create: `components/marketing/deck.tsx`
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `README.md`
- Modify: `app/layout.tsx` only if the route groups need a passthrough root layout. The marketing route group uses the light tokens; do not force the studio background onto it.
- Test: `tests/marketing.test.ts`

**Interfaces:**
- Consumes: the product facts in the Global Constraints
- Produces: `packages`, `faq`, `roles`, `calculator(months: 3 | 6 | 12): { team: number; once: number; save: number }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { calculator, faq, packages } from "../src/marketing/content";

describe("marketing offer", () => {
  it("matches the inspected price math", () => {
    expect(packages.map((p) => p.price)).toEqual([5_000_000, 7_000_000]);
    expect(calculator(12)).toEqual({ team: 228_000_000, once: 5_000_000, save: 223_000_000 });
    expect(calculator(3).team).toBe(57_000_000);
    expect(faq).toHaveLength(8);
    expect(faq.some((item) => item.answer.toLowerCase().includes("tiktok"))).toBe(true);
    expect(JSON.stringify({ packages, faq })).not.toMatch(/0899|jimmimohtar|1\.480/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/marketing.test.ts`

Expected: FAIL with cannot find module `../src/marketing/content`.

- [ ] **Step 3: Write the page, the deck, and the runbook**

`src/marketing/content.ts` exports the two packages, the five salary rows (3_500_000, 4_000_000, 4_000_000, 4_500_000, 3_000_000), `calculator`, and eight FAQ items. Package copy:

- `Development`, Rp5.000.000, `sekali bayar, bukan tahunan`. Points: custom untuk niche kamu, white-label, setup ke VPS kamu, serah terima aplikasi dan source code, perawatan 6 bulan, tanpa langganan ke pembuat.
- `Terima beres`, Rp7.000.000, `total untuk tahun pertama`. Points: semua yang ada di Development, VPS untuk 1 tahun, saldo awal token AI. Note: `Selisih Rp2 juta = VPS setahun + saldo awal token AI.`

FAQ answers must state: the fee is once; the Rp2 juta difference is the first year of VPS and a starting AI balance; there is no monthly fee to the maker; the buyer does not need to code; delivery is 14 days including a trial; payment is in full before work starts; posting uses the official Meta API and the account must be Business or Creator; TikTok and Reels are not included. Write the questions in Indonesian in the same order as the live page, in your own sentences. `CONTACT_WA` is read from the env at render time. When it is empty, do not render a WhatsApp button. When `NEXT_PUBLIC_BATCH_NOTE` is empty, do not render a scarcity banner.

The home page is a light, single column (`max-w-[760px]`, wider `1120px` only for the agent row). Sections, in order: navy hero with the promise that the agents find, write, and design and the human approves; four chips (24 jam, 14 hari, tanpa tim, milik kamu); an ethics section for the 2-slide teaser; four problem/answer pairs; the four agents as colored cards with no character illustrations; the six audience chips; an iframe `src="/presentasi"` with `Buka layar penuh`; the salary calculator; the two price cards; the vendor-cost table (5/10/15/30 posts a day at Rp200, so Rp30rb / Rp60rb / Rp90rb / Rp180rb per month and the yearly figures Rp365rb, Rp730rb, Rp1,1jt, Rp2,2jt); the FAQ as `<details>`; a closing consult line. The proof section shows three slides rendered by `renderSlideHtml` for a fixture article titled `Contoh carousel`, saved as static PNG files generated in a script `scripts/sample-slides.ts` using Playwright. Do not hotlink Instagram. Do not use the live site's client accounts.

`components/marketing/calculator.tsx` is a client component. Buttons `3 Bulan`, `6 Bulan`, `12 Bulan / 1 Tahun` set `aria-pressed`. Default 12. It shows `Total gaji tim {n} bulan`, the team total, `Otomasi, sekali bayar`, and `Kamu hemat`.

`components/marketing/deck.tsx` is a client component with 12 slides, prev/next buttons, and a fullscreen button using `element.requestFullscreen()`. Slides: the promise, the four pains, the agent relay, sources, brain, radar, overview, review, the two formats, publish rules, analytics, and the 14-day handover. Keyboard `ArrowLeft` and `ArrowRight` move the index. The presentasi page title is `Cara kerja Redaksi`.

`Dockerfile`: node 22 alpine, `npm ci`, `npm run build`, `npx playwright install --with-deps chromium`, `CMD ["npm", "start"]`. `docker-compose.yml` has `db` (`postgres:16`, user/db/password `redaksi`, volume `pg`), `web` (build `.`, port `43123:43123`, `DATABASE_URL=postgres://redaksi:redaksi@db:5432/redaksi`, `CRON_SECRET`, `LLM_PROVIDER=demo`, `META_PROVIDER=fake`, `PUBLIC_BASE_URL=http://127.0.0.1:43123`, `SEED_DEMO=1`), and `cron` (curlimages/curl, loop every 60 seconds, `POST http://web:43123/api/cron` with the bearer secret).

`.env.example` lists `DATABASE_URL`, `CRON_SECRET`, `LLM_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_INPUT_USD_PER_MTOK`, `OPENAI_OUTPUT_USD_PER_MTOK`, `META_PROVIDER`, `PUBLIC_BASE_URL`, `CONTACT_WA`, `SEED_DEMO`.

`README.md` covers: what Redaksi is, `npm install`, `npm test`, `npm run dev` on port 43123, demo seed (`SEED_DEMO=1` creates `admin@redaksi.local` / `redaksi-dev-only` and refuses to run when `NODE_ENV=production`), how to switch on OpenAI and Meta, the human-approval rule, the "no news photos" rule, and the Docker command `docker compose up --build`. Add `src/db/boot.ts` and call it from the cron route and from a small `instrumentation.ts` `register()` hook: run `DDL`, `seedDefaults`, and when `SEED_DEMO=1` and `NODE_ENV !== "production"` insert the admin if missing. Hash the demo password with `hashPassword`.

On boot also enqueue one `scout.scan` and one `insights.sync` if no unfinished row of that name exists.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run`

Expected: PASS, every test file in this plan.

Run: `npm run build`

Expected: exit 0. If a route is missing a suspense boundary around `useSearchParams`, wrap that page's client part in `<Suspense>`.

- [ ] **Step 5: Commit**

```bash
git add src/marketing app/\(marketing\) components/marketing Dockerfile docker-compose.yml .env.example README.md src/db/boot.ts instrumentation.ts scripts/sample-slides.ts tests/marketing.test.ts
git commit -m "feat: add the sales page, the deck, and the VPS runbook"
```

---

## Self-review

Spec coverage:

- Human gate, official Meta API, source credit, and generated-or-uploaded visuals are Tasks 2, 10, 11, and 12.
- Scout, Analis, Copywriter, Designer, 30-minute cadence, and work hours are Tasks 2, 6, 7, 8, 9, and 10.
- Review tabs, editor, templates, formats, re-render, and manual posted are Task 11.
- Schedule and Kalender are Task 12. Kalender's grid is inferred.
- Analytics ranges, deltas, and the post table are Task 13.
- Brain, sources, team, and settings are Tasks 5, 7, and 15. Pengaturan's form is inferred from the controls the other screens need.
- Bio grid and `/s/{code}` are Task 14.
- Marketing prices, calculator, FAQ, and deck are Task 16.
- KOL room, TikTok, and Reels are intentionally absent.
- The live "1.480+" claim, the WhatsApp number, the batch-scarcity line, the six client grids, and the character art are intentionally absent.

Type names used above are stable: `DraftStatus`, `ActorKind`, `assertTransition`, `Sql`, `Role`, `Action`, `can`, `LlmProvider`, `Slide`, `DraftCopy`, `Rasterizer`, `Publisher`, `JobName`, `enqueue`, `runDueJobs`.
