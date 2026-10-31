import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestSql } from "../src/db/client";
import { assertTransition } from "../src/domain/status";
import { runInsights, runPublisher } from "../src/jobs/handlers";
import {
  PRACTICE_LOCKED,
  PUBLISH_DISCONNECTED,
  practiceBanner,
  setPracticeMode,
} from "../src/publish/mode";
import { FakePublisher } from "../src/publish/publisher";
import { listDrafts, scheduleDraft } from "../src/studio/drafts";
import { funnelCounts } from "../src/studio/overview";
import { getSettings } from "../src/studio/settings";

const envKeys = ["META_PROVIDER", "PUBLIC_BASE_URL"] as const;
const envSnapshot = new Map<string, string | undefined>(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of envSnapshot) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const DRAFT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const SLIDES = JSON.stringify([
  { role: "cover", kicker: "AI", headline: "Iklan baru bisa nyamar", body: "Pembuka." },
  { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
]);

async function seed(sql: Awaited<ReturnType<typeof createTestSql>>, status = "posting") {
  await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
    "11111111-1111-1111-1111-111111111111",
    "Contoh",
    "https://news.example/feed",
    "ID",
  ]);
  await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    "11111111-1111-1111-1111-111111111111",
    "Iklan",
    "https://news.example/a",
  ]);
  await sql.rows(
    `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
     values ($1,$2,$3,'teaser_bio','serif',$4::jsonb,'Dari Contoh','[]'::jsonb,'[]'::jsonb,'abcde')`,
    [DRAFT, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", status, SLIDES],
  );
}

function graphFetch(urls: string[]): typeof fetch {
  return async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("content_publishing_limit")) {
      return new Response(JSON.stringify({ data: [{ quota_usage: 0, config: { quota_total: 25 } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("fields=status_code")) {
      return new Response(JSON.stringify({ status_code: "FINISHED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "1789001" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("practice mode", () => {
  it("lets a worker store a fake publish as simulasi", () => {
    expect(() => assertTransition("worker", "posting", "simulasi")).not.toThrow();
    expect(() => assertTransition("worker", "needs_review", "simulasi")).toThrow(/publish requires human approval/);
  });

  it("keeps the fake adapter when the server locks practice, even if the toggle is off", async () => {
    process.env.META_PROVIDER = "fake";
    const sql = await createTestSql();
    await setPracticeMode(sql, "admin", true);
    await sql.rows("update brand set practice_mode = false where id = 1");
    await expect(setPracticeMode(sql, "admin", false)).rejects.toThrow(PRACTICE_LOCKED);
    const stored = await sql.rows<{ practice_mode: boolean }>("select practice_mode from brand where id = 1");
    expect(stored[0].practice_mode).toBe(false);
    await seed(sql);
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      throw new Error("practice must not call Meta");
    });
    const publisher = new FakePublisher();
    await runPublisher({
      sql,
      payload: { draftId: DRAFT },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
      publisher,
    });
    expect(calls).toBe(0);
    expect(publisher.calls).toHaveLength(1);
    const row = await sql.rows<{ status: string; ig_media_id: string }>(
      "select status, ig_media_id from drafts",
    );
    expect(row[0].status).toBe("simulasi");
    expect(row[0].ig_media_id.startsWith("fake_")).toBe(true);
    const posted = await listDrafts(sql, "posted");
    expect(posted).toHaveLength(0);
    const simulated = await listDrafts(sql, "simulasi");
    expect(simulated).toHaveLength(1);
  });

  it("posts through Meta only when the env allows it, the toggle is off, and Instagram is connected", async () => {
    process.env.META_PROVIDER = "meta";
    process.env.PUBLIC_BASE_URL = "https://studio.example";
    const sql = await createTestSql();
    await seed(sql);
    await setPracticeMode(sql, "admin", false);
    await sql.rows(
      `update ig_connection set ig_user_id = '1789', access_token = 'tok-plain', username = 'analystdigest.id',
         api_host = 'facebook', token_error = null where id = 1`,
    );
    await sql.rows("insert into assets (id, draft_id, slide_index, bytes) values ($1,$2,0,$3)", [
      "cccccccc-cccc-cccc-cccc-ccccccccccc1",
      DRAFT,
      Buffer.from("png"),
    ]);
    const urls: string[] = [];
    vi.stubGlobal("fetch", graphFetch(urls));
    await runPublisher({
      sql,
      payload: { draftId: DRAFT },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
    });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith("https://graph.facebook.com/"))).toBe(true);
    const row = await sql.rows<{ status: string; ig_media_id: string }>(
      "select status, ig_media_id from drafts",
    );
    expect(row[0]).toMatchObject({ status: "posted", ig_media_id: "1789001" });
  });

  it("blocks a live publish when the connection is missing or invalid and still guards the public URL", async () => {
    process.env.META_PROVIDER = "meta";
    const sql = await createTestSql();
    await seed(sql);
    await setPracticeMode(sql, "admin", false);
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      throw new Error("must not call Meta");
    });
    await runPublisher({
      sql,
      payload: { draftId: DRAFT },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
    });
    expect(calls).toBe(0);
    const missing = await sql.rows<{ status: string; error: string }>("select status, error from drafts");
    expect(missing[0]).toMatchObject({ status: "failed", error: PUBLISH_DISCONNECTED });

    await sql.rows(
      `update drafts set status = 'posting', error = null where id = $1`,
      [DRAFT],
    );
    await sql.rows(
      `update ig_connection set ig_user_id = '1789', access_token = 'tok-plain', username = 'meja',
         token_error = 'Token tidak valid, sambungkan ulang' where id = 1`,
    );
    await runPublisher({
      sql,
      payload: { draftId: DRAFT },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
    });
    const invalid = await sql.rows<{ error: string }>("select error from drafts");
    expect(invalid[0].error).toBe("Token tidak valid, sambungkan ulang");
    expect(calls).toBe(0);

    await sql.rows("update ig_connection set token_error = null where id = 1");
    await sql.rows("update drafts set status = 'needs_review', error = null where id = $1", [DRAFT]);
    await expect(scheduleDraft(sql, "admin", DRAFT, new Date(Date.now() + 3600_000))).resolves.toBeUndefined();
    await sql.rows("update brand set public_base_url = 'http://127.0.0.1:43123' where id = 1");
    await sql.rows("update drafts set status = 'posting' where id = $1", [DRAFT]);
    delete process.env.PUBLIC_BASE_URL;
    await runPublisher({
      sql,
      payload: { draftId: DRAFT },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
    });
    const local = await sql.rows<{ error: string }>("select error from drafts");
    expect(local[0].error).toMatch(/URL publik/);
    expect(calls).toBe(0);
  });

  it("does not count a new simulasi row as sudah posting and leaves an older posted row", async () => {
    const sql = await createTestSql();
    await setPracticeMode(sql, "admin", true);
    await seed(sql, "posted");
    await sql.rows(
      `update drafts set ig_media_id = 'fake_1', posted_at = $1 where id = $2`,
      ["2026-10-31T09:19:02.550Z", DRAFT],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, ig_media_id, posted_at)
       values ($1,$2,'simulasi','teaser_bio','serif',$3::jsonb,'cap','[]'::jsonb,'[]'::jsonb,'fake2','fake_2',$4)`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        SLIDES,
        "2026-10-31T09:19:02.550Z",
      ],
    );
    const posted = await listDrafts(sql, "posted");
    expect(posted.map((row) => row.id)).toEqual([DRAFT]);
    const week = await funnelCounts(sql, new Date("2026-10-31T10:00:00Z"));
    expect(week.postedThisWeek).toBe(1);
    const settings = await getSettings(sql);
    expect(settings.effectivePractice).toBe(true);
    expect(settings.modeBanner).toBe("Mode latihan: posting tidak dikirim ke Instagram.");
    process.env.META_PROVIDER = "fake";
    const locked = await getSettings(sql);
    expect(locked.envLocksPractice).toBe(true);
    expect(locked.modeBanner).toContain("Dikunci oleh server");
    expect(practiceBanner({ practice: false, envLocked: false, username: "analystdigest.id" })).toBe(
      "Mode siaran: posting dikirim ke @analystdigest.id.",
    );
  });

  it("skips insights while practice is on and refuses the toggle for a viewer", async () => {
    process.env.META_PROVIDER = "meta";
    const sql = await createTestSql();
    await sql.rows(
      `update ig_connection set ig_user_id = '1789', access_token = 'tok-plain', username = 'meja' where id = 1`,
    );
    let calls = 0;
    await runInsights({
      sql,
      payload: {},
      manual: false,
      now: new Date("2026-10-28T02:00:00Z"),
      fetchImpl: async () => {
        calls += 1;
        throw new Error("practice must not call Meta");
      },
    });
    expect(calls).toBe(0);
    await expect(setPracticeMode(sql, "viewer", false)).rejects.toThrow(/forbidden/);
    await expect(setPracticeMode(sql, "social_media", false)).rejects.toThrow(/forbidden/);
  });
});
