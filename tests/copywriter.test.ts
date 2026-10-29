import { describe, expect, it } from "vitest";
import { parseCopy } from "../src/agents/copywriter";
import { DemoLlm } from "../src/llm/provider";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { runCopywriter } from "../src/jobs/handlers";
import { enqueue } from "../src/jobs/runner";

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
  it("title-cases a shouted or mixed slide category", () => {
    const copy = parseCopy(
      JSON.stringify({
        ...good,
        slides: good.slides.map((slide, index) =>
          index === 0 ? { ...slide, kicker: "EKspansi Global" } : slide,
        ),
      }),
      "Contoh",
    );
    expect(copy.slides[0]?.kicker).toBe("Ekspansi Global");
    expect(copy.slides[1]?.kicker).toBe("Fakta");
  });

  it("strips hash marks and casing from hashtags", () => {
    const copy = parseCopy(
      JSON.stringify({ ...good, hashtags: ["#Iklan", " MedSos ", "sumber!"] }),
      "Contoh",
    );
    expect(copy.hashtags).toEqual(["iklan", "medsos", "sumber"]);
  });

  it("accepts one content slide plus a closing slide", () => {
    const slim = {
      ...good,
      slides: [good.slides[0], good.slides[1], good.slides[3]],
    };
    expect(parseCopy(JSON.stringify(slim), "Contoh").slides.map((slide) => slide.role)).toEqual([
      "cover",
      "point",
      "cta",
    ]);
  });

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
    const drafts = await sql.rows<{ status: string; format: string; template: string }>(
      "select status, format, template from drafts",
    );
    expect(drafts).toEqual([{ status: "drafted", format: "carousel_full", template: "berita_pro" }]);
    const jobs = await sql.rows<{ name: string }>("select name from jobs where name = 'designer.render'");
    expect(jobs).toHaveLength(1);
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'copywriter'");
    expect(log[0].message.startsWith("Draft siap:")).toBe(true);
  });

  it("cancels a scheduled publish when a rewrite changes the text", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const topicId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state, score) values ($1,$2,$3,$4,'drafted',80)",
      [topicId, "11111111-1111-1111-1111-111111111111", "Iklan baru", "https://news.example/a"],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'scheduled','teaser_bio','serif',$3::jsonb,'Caption lama dari Contoh.',$4::jsonb,$5::jsonb,'sched')`,
      [
        draftId,
        topicId,
        JSON.stringify([
          { role: "cover", kicker: "Lama", headline: "Judul lama yang cukup", body: "Lama." },
          { role: "point", kicker: "Fakta", headline: "Poin lama yang cukup", body: "Detail." },
          { role: "point", kicker: "Dampak", headline: "Poin dua yang cukup", body: "Detail." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
        JSON.stringify(["lama"]),
        JSON.stringify(["Alt lama satu", "Alt lama dua"]),
      ],
    );
    await enqueue(sql, {
      name: "publisher.publish",
      payload: { draftId },
      runAt: new Date(Date.now() + 3_600_000),
    });
    await runCopywriter({
      sql,
      payload: { topicId, rewrite: true },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
      llm: new DemoLlm(),
    });
    const drafts = await sql.rows<{ status: string; text_dirty: boolean }>(
      "select status, text_dirty from drafts where id = $1",
      [draftId],
    );
    expect(drafts[0]).toMatchObject({ status: "needs_review", text_dirty: true });
    const jobs = await sql.rows(
      `select id from jobs
       where name = 'publisher.publish' and finished_at is null and payload->>'draftId' = $1`,
      [draftId],
    );
    expect(jobs).toHaveLength(0);
  });

  it("leaves a posting draft unchanged when a rewrite runs", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const topicId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    const headline = "Judul yang sudah disetujui";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state, score) values ($1,$2,$3,$4,'passed',80)",
      [topicId, "11111111-1111-1111-1111-111111111111", "Iklan baru", "https://news.example/a"],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, text_dirty)
       values ($1,$2,'posting','teaser_bio','serif',$3::jsonb,'Caption lama dari Contoh.',$4::jsonb,$5::jsonb,'postn',false)`,
      [
        draftId,
        topicId,
        JSON.stringify([
          { role: "cover", kicker: "Lama", headline, body: "Lama." },
          { role: "point", kicker: "Fakta", headline: "Poin lama yang cukup", body: "Detail." },
          { role: "point", kicker: "Dampak", headline: "Poin dua yang cukup", body: "Detail." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
        JSON.stringify(["lama"]),
        JSON.stringify(["Alt lama satu", "Alt lama dua"]),
      ],
    );
    await enqueue(sql, {
      name: "publisher.publish",
      payload: { draftId },
      runAt: new Date(),
      manual: true,
    });
    await runCopywriter({
      sql,
      payload: { topicId, rewrite: true },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
      llm: new DemoLlm(),
    });
    const rows = await sql.rows<{ slides: unknown; text_dirty: boolean; status: string }>(
      "select slides, text_dirty, status from drafts where id = $1",
      [draftId],
    );
    const slides = (
      typeof rows[0].slides === "string" ? JSON.parse(rows[0].slides) : rows[0].slides
    ) as { headline: string }[];
    expect(slides[0]?.headline).toBe(headline);
    expect(rows[0]).toMatchObject({ status: "posting", text_dirty: false });
    const topic = await sql.rows<{ state: string }>("select state from topics where id = $1", [topicId]);
    expect(topic[0]?.state).toBe("passed");
    const renderJobs = await sql.rows("select id from jobs where name = 'designer.render'");
    expect(renderJobs).toHaveLength(0);
    const publishJobs = await sql.rows(
      `select id from jobs
       where name = 'publisher.publish' and finished_at is null and payload->>'draftId' = $1`,
      [draftId],
    );
    expect(publishJobs).toHaveLength(1);
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'copywriter'");
    expect(log.some((row) => row.message.startsWith("Draft siap:"))).toBe(false);
  });

  it("does not call the model when a rewrite draft is already posting", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const topicId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state, score) values ($1,$2,$3,$4,'drafted',80)",
      [topicId, "11111111-1111-1111-1111-111111111111", "Iklan baru", "https://news.example/a"],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'posting','teaser_bio','serif',$3::jsonb,'Caption lama dari Contoh.',$4::jsonb,$5::jsonb,'postn')`,
      [
        draftId,
        topicId,
        JSON.stringify([
          { role: "cover", kicker: "Lama", headline: "Judul yang sudah disetujui", body: "Lama." },
          { role: "point", kicker: "Fakta", headline: "Poin lama yang cukup", body: "Detail." },
          { role: "point", kicker: "Dampak", headline: "Poin dua yang cukup", body: "Detail." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
        JSON.stringify(["lama"]),
        JSON.stringify(["Alt lama satu", "Alt lama dua"]),
      ],
    );
    await expect(
      runCopywriter({
        sql,
        payload: { topicId, rewrite: true },
        manual: true,
        now: new Date("2026-10-28T02:00:00Z"),
        llm: {
          complete: async () => {
            throw new Error("complete must not run");
          },
        },
      }),
    ).resolves.toBeUndefined();
    const topic = await sql.rows<{ state: string }>("select state from topics where id = $1", [topicId]);
    expect(topic[0]?.state).toBe("drafted");
    const spend = await sql.rows("select id from llm_spend");
    expect(spend).toHaveLength(0);
    const renderJobs = await sql.rows("select id from jobs where name = 'designer.render'");
    expect(renderJobs).toHaveLength(0);
  });

  it("does not fail the topic when a rewrite draft becomes posting during a bad parse", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const topicId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state, score) values ($1,$2,$3,$4,'drafted',80)",
      [topicId, "11111111-1111-1111-1111-111111111111", "Iklan baru", "https://news.example/a"],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'needs_review','teaser_bio','serif',$3::jsonb,'Caption lama dari Contoh.',$4::jsonb,$5::jsonb,'race1')`,
      [
        draftId,
        topicId,
        JSON.stringify([
          { role: "cover", kicker: "Lama", headline: "Judul yang sudah disetujui", body: "Lama." },
          { role: "point", kicker: "Fakta", headline: "Poin lama yang cukup", body: "Detail." },
          { role: "point", kicker: "Dampak", headline: "Poin dua yang cukup", body: "Detail." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
        JSON.stringify(["lama"]),
        JSON.stringify(["Alt lama satu", "Alt lama dua"]),
      ],
    );
    await runCopywriter({
      sql,
      payload: { topicId, rewrite: true },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
      llm: {
        complete: async () => {
          await sql.rows("update drafts set status = 'posting' where id = $1", [draftId]);
          return { text: "bukan json", costUsd: 0.01, model: "test" };
        },
      },
    });
    const topic = await sql.rows<{ state: string }>("select state from topics where id = $1", [topicId]);
    expect(topic[0]?.state).toBe("drafted");
    const activity = await sql.rows<{ message: string }>(
      "select message from activity where agent = 'copywriter'",
    );
    expect(activity.some((row) => row.message.startsWith("Gagal menulis"))).toBe(false);
  });

  it("keeps a valid cover photo data url when a rewrite replaces the slides", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const topicId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    const photo = `data:image/png;base64,${Buffer.from("png-photo").toString("base64")}`;
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state, score) values ($1,$2,$3,$4,'drafted',80)",
      [topicId, "11111111-1111-1111-1111-111111111111", "Iklan baru", "https://news.example/a"],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'needs_review','teaser_bio','serif',$3::jsonb,'Caption lama dari Contoh.',$4::jsonb,$5::jsonb,'photo')`,
      [
        draftId,
        topicId,
        JSON.stringify([
          {
            role: "cover",
            kicker: "Lama",
            headline: "Judul lama yang cukup",
            body: "Lama.",
            photoDataUrl: photo,
          },
          { role: "point", kicker: "Fakta", headline: "Poin lama yang cukup", body: "Detail." },
          { role: "point", kicker: "Dampak", headline: "Poin dua yang cukup", body: "Detail." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
        JSON.stringify(["lama"]),
        JSON.stringify(["Alt lama satu", "Alt lama dua"]),
      ],
    );
    await runCopywriter({
      sql,
      payload: { topicId, rewrite: true },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
      llm: new DemoLlm(),
    });
    const rows = await sql.rows<{ slides: unknown }>("select slides from drafts where id = $1", [draftId]);
    const slides = (
      typeof rows[0].slides === "string" ? JSON.parse(rows[0].slides) : rows[0].slides
    ) as { role: string; headline: string; photoDataUrl?: string }[];
    expect(slides[0]).toMatchObject({ role: "cover", photoDataUrl: photo });
    expect(slides[0].headline).not.toBe("Judul lama yang cukup");
    expect(slides.some((slide) => slide.role !== "cover" && slide.photoDataUrl)).toBe(false);
  });

  it("does not insert a second draft when a non-rewrite job runs again", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const topicId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state, score) values ($1,$2,$3,$4,'passed',80)",
      [topicId, "11111111-1111-1111-1111-111111111111", "Iklan baru", "https://news.example/a"],
    );
    const ctx = {
      sql,
      payload: { topicId },
      manual: true,
      now: new Date("2026-10-28T02:00:00Z"),
      llm: new DemoLlm(),
    };
    await runCopywriter(ctx);
    await runCopywriter(ctx);
    const drafts = await sql.rows<{ id: string }>("select id from drafts where topic_id = $1", [topicId]);
    expect(drafts).toHaveLength(1);
    const topic = await sql.rows<{ state: string }>("select state from topics where id = $1", [topicId]);
    expect(topic[0]?.state).toBe("drafted");
  });
});
