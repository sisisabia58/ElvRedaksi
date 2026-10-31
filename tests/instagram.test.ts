import { afterEach, describe, expect, it, vi } from "vitest";
import { openAccessToken, sealAccessToken } from "../src/auth/token-cipher";
import { createTestSql } from "../src/db/client";
import { ensureSchemaExtras } from "../src/db/boot";
import {
  DEFAULT_PUBLIC_BASE_URL,
  HTTPS_PUBLIC_URL_ERROR,
  LOCAL_PUBLIC_URL_ERROR,
  resolvePublicBaseUrl,
} from "../src/domain/public-url";
import { runInsights, runInstagramRefresh, runPublisher } from "../src/jobs/handlers";
import { setPracticeMode } from "../src/publish/mode";
import { CONTAINER_POLL_DELAYS_MS, FakePublisher, MetaPublisher } from "../src/publish/publisher";
import { connectInstagram, getSettings, saveInstagramToken } from "../src/studio/settings";
import {
  REFRESH_FAILED,
  TOKEN_EXPIRED_DETAIL,
  TOKEN_INVALID_DETAIL,
  TOKEN_INVALID_STATUS,
  TOKEN_RECONNECT,
  SEVERAL_IG_ACCOUNTS,
  TOKEN_UNREACHABLE,
  describeInstagramConnection,
  validateInstagramToken,
} from "../src/instagram/token";

const DAY = 24 * 60 * 60 * 1000;
const envKeys = ["META_PROVIDER", "PUBLIC_BASE_URL", "TOKEN_ENCRYPTION_KEY", "CRON_SECRET"] as const;
const envSnapshot = new Map<string, string | undefined>(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of envSnapshot) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function postingDraft(sql: Awaited<ReturnType<typeof createTestSql>>, draftId: string) {
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
    `https://news.example/${draftId}`,
  ]);
  await sql.rows(
    `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
     values ($1,$2,'posting','teaser_bio','serif',$3::jsonb,'Dari Contoh','[]'::jsonb,'[]'::jsonb,$4)`,
    [
      draftId,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      JSON.stringify([
        { role: "cover", kicker: "AI", headline: "Iklan baru bisa nyamar", body: "Pembuka." },
        { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
      ]),
      draftId.slice(0, 5),
    ],
  );
}

describe("public url", () => {
  it("uses PUBLIC_BASE_URL only as the fallback for the localhost default", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(resolvePublicBaseUrl(null)).toBe(DEFAULT_PUBLIC_BASE_URL);
    expect(resolvePublicBaseUrl(DEFAULT_PUBLIC_BASE_URL)).toBe(DEFAULT_PUBLIC_BASE_URL);
    process.env.PUBLIC_BASE_URL = "https://studio.example";
    expect(resolvePublicBaseUrl(DEFAULT_PUBLIC_BASE_URL)).toBe("https://studio.example");
    expect(resolvePublicBaseUrl("")).toBe("https://studio.example");
    expect(resolvePublicBaseUrl("https://custom.example/")).toBe("https://custom.example");
  });

  it("refuses a localhost or non-https image host when Meta is live", async () => {
    process.env.META_PROVIDER = "meta";
    delete process.env.PUBLIC_BASE_URL;
    const sql = await createTestSql();
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    await postingDraft(sql, draftId);
    await sql.rows(
      `insert into ig_connection (id, ig_user_id, access_token, username)
       values (1, $1, $2, $3)
       on conflict (id) do update set ig_user_id = $1, access_token = $2, username = $3`,
      ["1789", "tok-plain", "meja"],
    );
    await setPracticeMode(sql, "admin", false);
    const publisher = new FakePublisher();
    await runPublisher({
      sql,
      payload: { draftId },
      manual: false,
      now: new Date("2026-10-28T02:00:00Z"),
      attempts: 0,
      reclaimed: false,
      publisher,
    });
    expect(publisher.calls).toHaveLength(0);
    const failed = await sql.rows<{ error: string }>("select error from drafts");
    expect(failed[0].error).toBe(LOCAL_PUBLIC_URL_ERROR);

    await sql.rows("update brand set public_base_url = 'http://example.com' where id = 1");
    await sql.rows("update drafts set status = 'posting', error = null where id = $1", [draftId]);
    await runPublisher({
      sql,
      payload: { draftId },
      manual: false,
      now: new Date("2026-10-28T02:00:00Z"),
      attempts: 0,
      reclaimed: false,
      publisher,
    });
    const https = await sql.rows<{ error: string }>("select error from drafts");
    expect(https[0].error).toBe(HTTPS_PUBLIC_URL_ERROR);
    expect(publisher.calls).toHaveLength(0);
  });

  it("publishes through the env https origin and still allows localhost in latihan mode", async () => {
    const sql = await createTestSql();
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
    await postingDraft(sql, draftId);
    await sql.rows("insert into assets (id, draft_id, slide_index, bytes) values ($1,$2,0,$3)", [
      "cccccccc-cccc-cccc-cccc-ccccccccccc1",
      draftId,
      Buffer.from("png"),
    ]);
    await sql.rows(
      `insert into ig_connection (id, ig_user_id, access_token, username)
       values (1, '1789', 'tok-plain', 'meja')
       on conflict (id) do update set ig_user_id = '1789', access_token = 'tok-plain', username = 'meja'`,
    );
    process.env.META_PROVIDER = "meta";
    process.env.PUBLIC_BASE_URL = "https://studio.example";
    await setPracticeMode(sql, "admin", false);
    const live = new FakePublisher();
    await runPublisher({
      sql,
      payload: { draftId },
      manual: false,
      now: new Date("2026-10-28T02:00:00Z"),
      attempts: 0,
      reclaimed: false,
      publisher: live,
    });
    expect(live.calls[0].imageUrls).toEqual(["https://studio.example/media/cccccccc-cccc-cccc-cccc-ccccccccccc1"]);

    process.env.META_PROVIDER = "fake";
    delete process.env.PUBLIC_BASE_URL;
    const draftId2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3";
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
      "11111111-1111-1111-1111-111111111111",
      "Iklan",
      "https://news.example/other",
    ]);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'posting','teaser_bio','serif',$3::jsonb,'Dari Contoh','[]'::jsonb,'[]'::jsonb,'fake1')`,
      [
        draftId2,
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
        JSON.stringify([
          { role: "cover", kicker: "AI", headline: "Iklan baru bisa nyamar", body: "Pembuka." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
      ],
    );
    const latihan = new FakePublisher();
    await runPublisher({
      sql,
      payload: { draftId: draftId2 },
      manual: false,
      now: new Date("2026-10-28T02:05:00Z"),
      attempts: 0,
      reclaimed: false,
      publisher: latihan,
    });
    expect(latihan.calls).toHaveLength(1);
    const posted = await sql.rows<{ status: string }>("select status from drafts where id = $1", [draftId2]);
    expect(posted[0].status).toBe("simulasi");
  });
});

describe("instagram token", () => {
  it("checks /me with a bearer header and stores the account Instagram returns", async () => {
    const sql = await createTestSql();
    await sql.rows(
      `insert into brand (name, handle, initial, accent, kicker) values ('A', '', 'A', '#4E708C', 'K')`,
    );
    const secret = "tok-plain";
    let seen = "";
    let calls = 0;
    let authorization = "";
    await connectInstagram(sql, "admin", secret, async (input, init) => {
      calls += 1;
      seen = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return json({ user_id: 1789, username: "@meja" });
    });
    expect(calls).toBe(1);
    const url = new URL(seen);
    expect(`${url.origin}${url.pathname}`).toBe("https://graph.instagram.com/v26.0/me");
    expect(url.searchParams.get("fields")).toBe("user_id,username");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(authorization).toBe(`Bearer ${secret}`);
    const settings = await getSettings(sql);
    expect(settings.igUsername).toBe("meja");
    const host = await sql.rows<{ api_host: string }>("select api_host from ig_connection");
    expect(host[0].api_host).toBe("instagram");
    expect(settings.igStatus).toMatch(/^Terhubung sebagai @meja \(dicek .+ WIB\)$/);
    expect(JSON.stringify(settings)).not.toContain(secret);
    const row = await sql.rows<{ expires_at: string | Date }>("select expires_at from ig_connection");
    const remaining = new Date(row[0].expires_at).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(59 * DAY);
    expect(remaining).toBeLessThan(61 * DAY);
  });

  it("rejects an invalid or unreachable token and does not store it", async () => {
    const sql = await createTestSql();
    const secret = "tok-rejected";
    await expect(
      connectInstagram(sql, "admin", secret, async () =>
        json({ error: { message: `echo ${secret}`, code: 190 } }, 400),
      ),
    ).rejects.toThrow(TOKEN_INVALID_STATUS);
    await expect(
      validateInstagramToken(secret, async () =>
        json({ error: { message: `echo ${secret}`, code: 190, error_subcode: 463 } }, 400),
      ),
    ).rejects.toThrow(TOKEN_INVALID_STATUS);
    await expect(validateInstagramToken(secret, async () => {
      throw new Error(`down ${secret}`);
    })).rejects.toThrow(TOKEN_UNREACHABLE);
    const row = await sql.rows<{ access_token: string | null }>("select access_token from ig_connection");
    expect(row[0].access_token).toBeNull();
    expect(TOKEN_INVALID_DETAIL).not.toContain(secret);
    expect(TOKEN_EXPIRED_DETAIL).not.toContain(secret);
  });

  it("describes connection, expiry, and a failed refresh", () => {
    const now = new Date("2026-10-28T02:00:00Z");
    const checked = new Date("2026-10-28T02:00:00Z");
    const connected = describeInstagramConnection({
      username: "meja",
      hasToken: true,
      checkedAt: checked,
      expiresAt: new Date(now.getTime() + 40 * DAY),
      tokenError: null,
      refreshError: null,
      now,
    });
    expect(connected.status).toBe("Terhubung sebagai @meja (dicek 28 Okt 2026, 09.00 WIB)");
    expect(connected.needsToken).toBe(false);

    const soon = describeInstagramConnection({
      username: "meja",
      hasToken: true,
      checkedAt: checked,
      expiresAt: new Date(now.getTime() + 3 * DAY),
      tokenError: null,
      refreshError: REFRESH_FAILED,
      now,
    });
    expect(soon.status).toBe("Token kedaluwarsa dalam 3 hari");
    expect(soon.warning).toBe(REFRESH_FAILED);

    const invalid = describeInstagramConnection({
      username: "meja",
      hasToken: true,
      checkedAt: checked,
      expiresAt: new Date(now.getTime() + 40 * DAY),
      tokenError: TOKEN_INVALID_DETAIL,
      refreshError: REFRESH_FAILED,
      now,
    });
    expect(invalid.status).toBe(TOKEN_INVALID_STATUS);
    expect(invalid.needsToken).toBe(true);
    expect(invalid.warning).toBeNull();
  });

  it("encrypts the token at rest and still reads a legacy plaintext row", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "unit-test-key";
    delete process.env.CRON_SECRET;
    const sql = await createTestSql();
    await sql.rows(
      `insert into brand (name, handle, initial, accent, kicker) values ('A', '', 'A', '#4E708C', 'K')`,
    );
    await saveInstagramToken(sql, "admin", {
      igUserId: "1789",
      accessToken: "tok-plain",
      username: "meja",
    });
    const row = await sql.rows<{ access_token: string }>("select access_token from ig_connection");
    expect(row[0].access_token.startsWith("enc:v1:")).toBe(true);
    expect(row[0].access_token).not.toContain("tok-plain");
    expect(openAccessToken(row[0].access_token)).toBe("tok-plain");
    expect(openAccessToken("tok-legacy")).toBe("tok-legacy");
    const settings = await getSettings(sql);
    expect(JSON.stringify(settings)).not.toContain("tok-plain");

    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(openAccessToken(row[0].access_token)).toBe("");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sealAccessToken("tok-plain")).toBe("tok-plain");
    for (const call of warn.mock.calls) {
      expect(call.map(String).join(" ")).not.toContain("tok-plain");
    }
    warn.mockRestore();
  });

  it("refreshes a due long-lived token with a bearer header and never writes the token into the error", async () => {
    process.env.META_PROVIDER = "meta";
    process.env.TOKEN_ENCRYPTION_KEY = "unit-test-key";
    const sql = await createTestSql();
    await setPracticeMode(sql, "admin", false);
    const now = new Date("2026-10-28T02:00:00Z");
    await sql.rows(
      `update ig_connection
       set ig_user_id = $1, access_token = $2, username = $3,
           connected_at = $4, expires_at = $5, refreshed_at = null
       where id = 1`,
      ["1789", "tok-old", "meja", new Date(now.getTime() - 25 * 60 * 60 * 1000), new Date(now.getTime() + 10 * DAY)],
    );
    const secret = "tok-old";
    let authorization = "";
    let seen = "";
    await runInstagramRefresh({
      sql,
      payload: {},
      manual: false,
      now,
      fetchImpl: async (input, init) => {
        seen = String(input);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return json({ access_token: "tok-new", token_type: "bearer", expires_in: 1000 });
      },
    });
    const url = new URL(seen);
    expect(`${url.origin}${url.pathname}`).toBe("https://graph.instagram.com/refresh_access_token");
    expect(url.searchParams.get("grant_type")).toBe("ig_refresh_token");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(authorization).toBe(`Bearer ${secret}`);
    const row = await sql.rows<{
      access_token: string;
      expires_at: string | Date;
      refreshed_at: string | Date;
      refresh_error: string | null;
    }>("select access_token, expires_at, refreshed_at, refresh_error from ig_connection");
    expect(row[0].access_token).not.toContain("tok-new");
    expect(openAccessToken(row[0].access_token)).toBe("tok-new");
    expect(new Date(row[0].expires_at).toISOString()).toBe(new Date(now.getTime() + 1000 * 1000).toISOString());
    expect(new Date(row[0].refreshed_at).toISOString()).toBe(now.toISOString());
    expect(row[0].refresh_error).toBeNull();
    const jobs = await sql.rows<{ run_at: string | Date }>(
      "select run_at from jobs where name = 'ig.refresh' and finished_at is null",
    );
    expect(new Date(jobs[0].run_at).toISOString()).toBe(new Date(now.getTime() + DAY).toISOString());

    await sql.rows(
      `update ig_connection set access_token = $1, connected_at = $2, expires_at = $3, refreshed_at = null, refresh_error = null, token_error = null where id = 1`,
      ["tok-old", new Date(now.getTime() - 25 * 60 * 60 * 1000), new Date(now.getTime() + 10 * DAY)],
    );
    await runInstagramRefresh({
      sql,
      payload: {},
      manual: false,
      now,
      fetchImpl: async () => json({ error: { message: "echo tok-old", code: 190 } }, 400),
    });
    const failed = await sql.rows<{ refresh_error: string; token_error: string; access_token: string }>(
      "select refresh_error, token_error, access_token from ig_connection",
    );
    expect(failed[0].refresh_error).toBe(REFRESH_FAILED);
    expect(failed[0].token_error).toBe(TOKEN_INVALID_DETAIL);
    expect(failed[0].refresh_error).not.toContain("tok-old");
    expect(failed[0].token_error).not.toContain("tok-old");
    expect(failed[0].access_token).toBe("tok-old");
  });

  it("skips the refresh call in latihan mode, when the token is young, far from expiry, or undated", async () => {
    const sql = await createTestSql();
    const now = new Date("2026-10-28T02:00:00Z");
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error("should not call");
    };
    process.env.META_PROVIDER = "fake";
    await sql.rows(
      `update ig_connection set access_token = 'tok-old', ig_user_id = '1789', username = 'meja',
         connected_at = $1, expires_at = $2 where id = 1`,
      [new Date(now.getTime() - 25 * 60 * 60 * 1000), new Date(now.getTime() + 10 * DAY)],
    );
    await runInstagramRefresh({ sql, payload: {}, manual: false, now, fetchImpl });
    expect(calls).toBe(0);

    process.env.META_PROVIDER = "meta";
    await setPracticeMode(sql, "admin", false);
    await sql.rows("update ig_connection set connected_at = $1 where id = 1", [
      new Date(now.getTime() - 23 * 60 * 60 * 1000),
    ]);
    await runInstagramRefresh({ sql, payload: {}, manual: false, now, fetchImpl });
    await sql.rows("update ig_connection set connected_at = $1, expires_at = $2 where id = 1", [
      new Date(now.getTime() - 25 * 60 * 60 * 1000),
      new Date(now.getTime() + 40 * DAY),
    ]);
    await runInstagramRefresh({ sql, payload: {}, manual: false, now, fetchImpl });
    await sql.rows("update ig_connection set expires_at = null where id = 1");
    await runInstagramRefresh({ sql, payload: {}, manual: false, now, fetchImpl });
    expect(calls).toBe(0);
  });

  it("accepts a system-user token on graph.facebook.com and does not expire it", async () => {
    const sql = await createTestSql();
    process.env.TOKEN_ENCRYPTION_KEY = "unit-test-key";
    await sql.rows(
      `insert into brand (name, handle, initial, accent, kicker) values ('A', '', 'A', '#4E708C', 'K')`,
    );
    const secret = "tok-suat";
    const urls: string[] = [];
    await connectInstagram(sql, "admin", secret, async (input, init) => {
      const url = new URL(String(input));
      urls.push(`${url.origin}${url.pathname}?${url.searchParams.get("fields")}`);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
      expect(url.searchParams.has("access_token")).toBe(false);
      if (url.hostname === "graph.instagram.com") return json({ error: { message: secret, code: 190 } }, 400);
      if (url.pathname.endsWith("/1789")) return json({ id: "1789", username: "analystdigest" });
      return json({ error: { message: secret } }, 400);
    }, "1789");
    expect(urls[0]).toContain("https://graph.instagram.com/v26.0/me");
    expect(urls.some((url) => url.startsWith("https://graph.facebook.com/v26.0/1789"))).toBe(true);
    expect(urls.some((url) => url.includes("/me/accounts"))).toBe(false);
    const row = await sql.rows<{ api_host: string; expires_at: string | null; username: string; access_token: string }>(
      "select api_host, expires_at, username, access_token from ig_connection",
    );
    expect(row[0].api_host).toBe("facebook");
    expect(row[0].expires_at).toBeNull();
    expect(row[0].username).toBe("analystdigest");
    expect(row[0].access_token).not.toContain(secret);
    const settings = await getSettings(sql);
    expect(settings.igStatus).toMatch(/Token tidak kedaluwarsa$/);
    expect(JSON.stringify(settings)).not.toContain(secret);
  });

  it("discovers one Instagram business account and asks for an id when there are several", async () => {
    const sql = await createTestSql();
    const secret = "tok-suat";
    const pages = {
      data: [
        { instagram_business_account: { id: "111", username: "satu" } },
        { instagram_business_account: { id: "222", username: "dua" } },
      ],
    };
    await expect(
      connectInstagram(sql, "admin", secret, async (input) => {
        const url = String(input);
        if (url.includes("graph.instagram.com")) return json({ error: { code: 190 } }, 400);
        if (url.includes("/me/accounts")) return json(pages);
        if (url.includes("/me?")) return json({ id: "system-user" });
        return json({ error: { code: 190 } }, 400);
      }),
    ).rejects.toThrow(SEVERAL_IG_ACCOUNTS);
    const empty = await sql.rows<{ access_token: string | null }>("select access_token from ig_connection");
    expect(empty[0].access_token).toBeNull();

    const urls: string[] = [];
    await connectInstagram(
      sql,
      "admin",
      secret,
      async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("graph.instagram.com")) return json({ error: { code: 190 } }, 400);
        if (url.includes("/me/accounts")) return json({ data: [pages.data[0]] });
        if (url.includes("/me?")) return json({ id: "system-user" });
        return json({ error: { code: 190 } }, 400);
      },
    );
    expect(urls.some((url) => url.includes("graph.facebook.com/v26.0/me?"))).toBe(true);
    expect(urls.some((url) => url.includes("/me/accounts"))).toBe(true);
    const row = await sql.rows<{ ig_user_id: string; username: string; api_host: string }>(
      "select ig_user_id, username, api_host from ig_connection",
    );
    expect(row[0]).toMatchObject({ ig_user_id: "111", username: "satu", api_host: "facebook" });
  });

  it("publishes on the stored Facebook host", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      expect(new URL(url).searchParams.has("access_token")).toBe(false);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok-suat");
      if (url.includes("content_publishing_limit")) {
        return json({ data: [{ quota_usage: 0, config: { quota_total: 25 } }] });
      }
      if (url.includes("fields=status_code")) return json({ status_code: "FINISHED" });
      return json({ id: "container" });
    };
    const meta = new MetaPublisher(fetchImpl, async () => {});
    await meta.publish({
      igUserId: "1789",
      accessToken: "tok-suat",
      imageUrls: ["https://studio.example/a.jpg"],
      caption: "cap",
      altTexts: ["alt"],
      shareToStory: false,
      graphHost: "facebook",
    });
    expect(urls.every((url) => url.startsWith("https://graph.facebook.com/v26.0/"))).toBe(true);
  });

  it("reads Facebook reach as a daily series and views as a window total", async () => {
    process.env.META_PROVIDER = "meta";
    const sql = await createTestSql();
    await setPracticeMode(sql, "admin", false);
    const now = new Date("2026-10-28T02:00:00Z");
    await sql.rows(
      `update ig_connection set ig_user_id = '1789', access_token = 'tok-suat', username = 'meja',
         api_host = 'facebook', expires_at = null where id = 1`,
    );
    const metrics: string[] = [];
    await runInsights({
      sql,
      payload: {},
      manual: true,
      now,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        expect(url.hostname).toBe("graph.facebook.com");
        expect(url.searchParams.has("access_token")).toBe(false);
        const metric = url.searchParams.get("metric");
        if (metric) metrics.push(metric);
        if (metric === "reach") {
          expect(url.searchParams.get("metric_type")).toBe("time_series");
          return json({
            data: [{ name: "reach", period: "day", values: [{ value: 4, end_time: "2026-10-29T00:00:00+07:00" }] }],
          });
        }
        if (metric === "views") {
          expect(url.searchParams.get("metric_type")).toBe("total_value");
          return json({ data: [{ name: "views", period: "day", total_value: { value: 9 } }] });
        }
        if (url.pathname.includes("/media")) return json({ data: [] });
        return json({ followers_count: 10, id: "1789" });
      },
    });
    expect(metrics).toEqual(["reach", "views"]);
    const snapshots = await sql.rows<{ views: number; reach: number }>("select views, reach from insight_snapshots");
    expect(snapshots[0].views).toBe(9);
    expect(snapshots[0].reach).toBe(4);
    const synced = await sql.rows<{ insights_error: string | null }>(
      "select insights_error from ig_connection",
    );
    expect(synced[0].insights_error).toBeNull();

    await sql.rows("delete from insight_snapshots");
    await runInsights({
      sql,
      payload: {},
      manual: true,
      now,
      fetchImpl: async () => json({ error: { message: "echo tok-suat", code: 190 } }, 400),
    });
    const marked = await sql.rows<{ token_error: string; insights_error: string | null }>(
      "select token_error, insights_error from ig_connection",
    );
    expect(marked[0].token_error).toBe(TOKEN_RECONNECT);
    expect(marked[0].token_error).not.toContain("tok-suat");
    expect(marked[0].insights_error ?? "").not.toContain("tok-suat");
    expect(marked[0].insights_error).toBe("echo");
  });

  it("does not refresh a non-expiring Facebook token", async () => {
    process.env.META_PROVIDER = "meta";
    const sql = await createTestSql();
    await setPracticeMode(sql, "admin", false);
    const now = new Date("2026-10-28T02:00:00Z");
    await sql.rows(
      `update ig_connection set access_token = 'tok-suat', ig_user_id = '1789', username = 'meja',
         api_host = 'facebook', connected_at = $1, expires_at = $2 where id = 1`,
      [new Date(now.getTime() - 25 * 60 * 60 * 1000), new Date(now.getTime() + 10 * DAY)],
    );
    let calls = 0;
    await runInstagramRefresh({
      sql,
      payload: {},
      manual: false,
      now,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("facebook tokens are not refreshed");
      },
    });
    expect(calls).toBe(0);
  });

  it("adds the token columns twice without failing", async () => {
    const sql = await createTestSql();
    await ensureSchemaExtras(sql);
    await ensureSchemaExtras(sql);
    const columns = await sql.rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'ig_connection' and column_name = 'expires_at'`,
    );
    expect(columns).toHaveLength(1);
    const host = await sql.rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'ig_connection' and column_name = 'api_host'`,
    );
    expect(host).toHaveLength(1);
    const practice = await sql.rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'brand' and column_name = 'practice_mode'`,
    );
    expect(practice).toHaveLength(1);
  });
});

describe("container polling", () => {
  it("waits about a minute with backoff before declaring a container unready", async () => {
    const total = CONTAINER_POLL_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThanOrEqual(60_000);
    expect(total).toBeLessThanOrEqual(90_000);
    const sleeps: number[] = [];
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      expect(new URL(url).searchParams.has("access_token")).toBe(false);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok-plain");
      if (url.includes("content_publishing_limit")) {
        return json({ data: [{ quota_usage: 0, config: { quota_total: 50 } }] });
      }
      if (url.includes("fields=status_code")) return json({ status_code: "IN_PROGRESS" });
      return json({ id: "child" });
    };
    const meta = new MetaPublisher(fetchImpl, async (ms) => {
      sleeps.push(ms);
    });
    await expect(
      meta.publish({
        igUserId: "1789",
        accessToken: "tok-plain",
        imageUrls: ["https://studio.example/a.jpg"],
        caption: "cap",
        altTexts: ["alt"],
        shareToStory: false,
      }),
    ).rejects.toThrow("Kontainer Instagram belum siap");
    expect(sleeps).toEqual(CONTAINER_POLL_DELAYS_MS);
    expect(urls.some((url) => url.includes("access_token="))).toBe(false);
  });
});
