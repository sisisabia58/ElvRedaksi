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
});
