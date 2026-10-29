import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { ScriptedLlm } from "../src/llm/provider";
import { runCopywriter } from "../src/jobs/handlers";
import { enqueueDemoRegeneration } from "../src/studio/regenerate-demo";

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
  tags: ["berita"],
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
    const draft = await sql.rows<{ status: string; caption: string }>(
      "select status, caption from drafts where id = $1",
      [DEMO_DRAFT],
    );
    expect(draft[0]).toMatchObject({
      status: "needs_review",
      caption: newCopy.caption,
    });
    const topic = await sql.rows<{ state: string; score_reason: string; score: number }>(
      "select state, score_reason, score from topics where id = $1",
      [DEMO_TOPIC],
    );
    expect(topic[0]).toMatchObject({
      state: "drafted",
      score_reason: "Skor dari model sungguhan.",
      score: 80,
    });
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
});
