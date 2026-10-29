import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { ScriptedLlm } from "../src/llm/provider";
import { runCopywriter } from "../src/jobs/handlers";
import { demoRewriteSummary } from "../src/studio/demo-rewrite-summary";
import { recordGeminiPause } from "../src/llm/gemini-gate";
import { demoRewriteSnapshot, enqueueDemoRegeneration, requeueStoppedGeminiRewrites } from "../src/studio/regenerate-demo";

const SOURCE = "11111111-1111-1111-1111-111111111111";
const DEMO_TOPIC = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const OTHER_TOPIC = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const DEMO_DRAFT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const OTHER_DRAFT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";

const oldSlides = [
  { role: "cover", kicker: "Lama", headline: "Judul lama yang cukup", body: "Lama." },
  { role: "point", kicker: "Fakta", headline: "Poin lama yang cukup", body: "Detail." },
  { role: "point", kicker: "Dampak", headline: "Poin dua yang cukup", body: "Detail." },
  { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
];

const newCopy = {
  slides: [
    { role: "cover", kicker: "Baru", headline: "Judul baru yang cukup", body: "Pembuka baru." },
    { role: "point", kicker: "Fakta", headline: "Fakta baru yang cukup", body: "Detail baru." },
    { role: "point", kicker: "Dampak", headline: "Dampak baru yang cukup", body: "Jangan salin." },
    { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Artikel di Contoh." },
  ],
  caption: "Ringkasan baru dari Contoh untuk audiens yang sama.",
  hashtags: ["iklan", "medsos", "sumber"],
  altHeadlines: ["Judul alternatif satu", "Judul alternatif dua"],
};

const newScore = {
  aspects: { relevansi: 18, emosi: 17, kebaruan: 16, timing: 15, shareability: 14 },
  tags: ["EKspansi Global"],
  sensitive: false,
  sensitiveReason: null,
  blocked: false,
  reason: "Skor dari model sungguhan.",
};

async function seedPair(
  sql: Awaited<ReturnType<typeof createTestSql>>,
  input: { topicId: string; draftId: string; status: string; reason: string; shortCode: string },
) {
  await sql.rows(
    `insert into topics (id, source_id, title, url, state, score, score_reason)
     values ($1,$2,$3,$4,'drafted',80,$5)`,
    [input.topicId, SOURCE, "Iklan baru", `https://news.example/${input.shortCode}`, input.reason],
  );
  await sql.rows(
    `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
     values ($1,$2,$3,'teaser_bio','serif',$4::jsonb,'Caption lama dari Contoh.',$5::jsonb,$6::jsonb,$7)`,
    [
      input.draftId,
      input.topicId,
      input.status,
      JSON.stringify(oldSlides),
      JSON.stringify(["lama", "sekali", "ya"]),
      JSON.stringify(["Alt lama satu", "Alt lama dua"]),
      input.shortCode,
    ],
  );
}

describe("demo draft regeneration", () => {
  it("labels leftover demo scores separately from the rewrite queue", () => {
    expect(demoRewriteSummary({ demoScores: 30, done: 25, total: 102 })).toEqual({
      score: "30 draf masih skor demo.",
      queue: "77 draf masih naskah demo. 25 dari 102 tulis ulang selesai.",
    });
    expect(demoRewriteSummary({ demoScores: 0, done: 0, total: 0 }).queue).toBeNull();
  });

  it("requeues only needs_review drafts whose score came from demo mode", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      SOURCE,
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await seedPair(sql, {
      topicId: DEMO_TOPIC,
      draftId: DEMO_DRAFT,
      status: "needs_review",
      reason: "Layak untuk audiens marketing (demo)",
      shortCode: "demo1",
    });
    await seedPair(sql, {
      topicId: OTHER_TOPIC,
      draftId: OTHER_DRAFT,
      status: "approved",
      reason: "Layak untuk audiens marketing (demo)",
      shortCode: "demo2",
    });
    expect(await enqueueDemoRegeneration(sql)).toBe(1);
    const jobs = await sql.rows<{ name: string; payload: { topicId?: string; regenerateDemo?: boolean }; manual: boolean }>(
      "select name, payload, manual from jobs",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: "copywriter.write",
      manual: true,
      payload: { topicId: DEMO_TOPIC, regenerateDemo: true },
    });
    expect(await enqueueDemoRegeneration(sql)).toBe(0);
  });

  it("rewrites score and copy and leaves the draft in needs_review", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      SOURCE,
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await seedPair(sql, {
      topicId: DEMO_TOPIC,
      draftId: DEMO_DRAFT,
      status: "needs_review",
      reason: "Layak untuk audiens marketing (demo)",
      shortCode: "demo1",
    });
    await runCopywriter({
      sql,
      payload: { topicId: DEMO_TOPIC, regenerateDemo: true },
      manual: true,
      now: new Date("2026-10-29T12:00:00Z"),
      llm: new ScriptedLlm([JSON.stringify(newScore), JSON.stringify(newCopy)]),
    });
    const draft = await sql.rows<{ status: string; caption: string; text_dirty: boolean }>(
      "select status, caption, text_dirty from drafts where id = $1",
      [DEMO_DRAFT],
    );
    expect(draft[0]).toMatchObject({
      status: "needs_review",
      caption: newCopy.caption,
      text_dirty: true,
    });
    const topic = await sql.rows<{ state: string; score_reason: string; score: number; tags: string[] | string }>(
      "select state, score_reason, score, tags from topics where id = $1",
      [DEMO_TOPIC],
    );
    const tags = typeof topic[0]?.tags === "string" ? JSON.parse(topic[0].tags) : topic[0]?.tags;
    expect(topic[0]).toMatchObject({
      state: "drafted",
      score_reason: "Skor dari model sungguhan.",
      score: 80,
    });
    expect(tags).toEqual(["Ekspansi Global"]);
    const jobs = await sql.rows<{ name: string }>("select name from jobs");
    expect(jobs.map((job) => job.name)).toEqual(["designer.render"]);
  });

  it("does not touch an approved draft", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      SOURCE,
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await seedPair(sql, {
      topicId: DEMO_TOPIC,
      draftId: DEMO_DRAFT,
      status: "approved",
      reason: "Layak untuk audiens marketing (demo)",
      shortCode: "demo1",
    });
    await runCopywriter({
      sql,
      payload: { topicId: DEMO_TOPIC, regenerateDemo: true },
      manual: true,
      now: new Date("2026-10-29T12:00:00Z"),
      llm: new ScriptedLlm([]),
    });
    const draft = await sql.rows<{ status: string; caption: string }>(
      "select status, caption from drafts",
    );
    expect(draft[0]).toMatchObject({ status: "approved", caption: "Caption lama dari Contoh." });
    const jobs = await sql.rows("select id from jobs");
    expect(jobs).toHaveLength(0);
  });

  it("counts rewritten drafts even when the job still carries a Gemini error", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      SOURCE,
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await seedPair(sql, {
      topicId: DEMO_TOPIC,
      draftId: DEMO_DRAFT,
      status: "needs_review",
      reason: "Skor dari model sungguhan.",
      shortCode: "done1",
    });
    await sql.rows(`update drafts set slides = $1::jsonb where id = $2`, [
      JSON.stringify(newCopy.slides),
      DEMO_DRAFT,
    ]);
    await seedPair(sql, {
      topicId: OTHER_TOPIC,
      draftId: OTHER_DRAFT,
      status: "needs_review",
      reason: "Layak untuk audiens marketing (demo)",
      shortCode: "stub1",
    });
    await sql.rows(`update drafts set slides = $1::jsonb where id = $2`, [
      JSON.stringify([
        { role: "cover", kicker: "AI", headline: "Masih judul demo yang lama", body: "Satu kalimat pembuka." },
      ]),
      OTHER_DRAFT,
    ]);
    const now = new Date("2026-10-29T13:00:00Z");
    await sql.rows(
      `insert into jobs (id, name, payload, run_at, finished_at, error)
       values ($1, 'copywriter.write', $2::jsonb, $3, $3, 'Gemini 503'),
              ($4, 'copywriter.write', $5::jsonb, $3, null, 'Gemini timeout')`,
      [
        "11111111-1111-4111-8111-111111111111",
        JSON.stringify({ topicId: DEMO_TOPIC, regenerateDemo: true }),
        now,
        "22222222-2222-4222-8222-222222222222",
        JSON.stringify({ topicId: OTHER_TOPIC, regenerateDemo: true }),
      ],
    );
    expect(await demoRewriteSnapshot(sql)).toEqual({ demoScores: 1, done: 1, total: 2 });
  });

  it("requeues only needs_review rewrites that stopped on a Gemini 429", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      SOURCE,
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await seedPair(sql, {
      topicId: DEMO_TOPIC,
      draftId: DEMO_DRAFT,
      status: "needs_review",
      reason: "Skor dari model sungguhan.",
      shortCode: "stop1",
    });
    await seedPair(sql, {
      topicId: OTHER_TOPIC,
      draftId: OTHER_DRAFT,
      status: "approved",
      reason: "Skor dari model sungguhan.",
      shortCode: "stop2",
    });
    const stopped = new Date("2026-10-29T13:00:00Z");
    const reset = new Date(stopped.getTime() + 3_600_000);
    await recordGeminiPause(sql, stopped, 3_600_000, {
      perDay: true,
      kind: "day",
      quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
      limit: "500",
    });
    await sql.rows(
      `insert into jobs (id, name, payload, run_at, finished_at, attempts, error, manual)
       values
         ($1, 'copywriter.write', $2::jsonb, $3, $3, 8, 'Gemini 429', true),
         ($4, 'copywriter.write', $5::jsonb, $3, $3, 8, 'Gemini 429', true),
         ($6, 'copywriter.write', $7::jsonb, $3, $3, 8, 'Gemini 503', true)`,
      [
        "11111111-1111-4111-8111-111111111111",
        JSON.stringify({ topicId: DEMO_TOPIC, regenerateDemo: true }),
        stopped,
        "22222222-2222-4222-8222-222222222222",
        JSON.stringify({ topicId: OTHER_TOPIC, regenerateDemo: true }),
        "33333333-3333-4333-8333-333333333333",
        JSON.stringify({ topicId: DEMO_TOPIC, regenerateDemo: true }),
      ],
    );
    await sql.rows(
      `update jobs set finished_at = $1, error = 'Gemini 503' where id = $2`,
      [new Date(stopped.getTime() + 1_000), "33333333-3333-4333-8333-333333333333"],
    );
    expect(await requeueStoppedGeminiRewrites(sql, stopped)).toBe(0);

    await sql.rows(`update jobs set finished_at = $1 where id = $2`, [
      new Date(stopped.getTime() - 1_000),
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(await requeueStoppedGeminiRewrites(sql, stopped)).toBe(1);
    const queued = await sql.rows<{ manual: boolean; run_at: Date | string; payload: { topicId?: string } }>(
      "select manual, run_at, payload from jobs where finished_at is null",
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]?.manual).toBe(true);
    expect(queued[0]?.payload.topicId).toBe(DEMO_TOPIC);
    const runAt = queued[0]?.run_at instanceof Date ? queued[0].run_at : new Date(String(queued[0]?.run_at));
    expect(runAt.getTime()).toBe(reset.getTime());
    expect(await requeueStoppedGeminiRewrites(sql, stopped)).toBe(0);
  });
});
