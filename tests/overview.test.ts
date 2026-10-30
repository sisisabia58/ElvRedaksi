import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import {
  funnelCounts,
  newsroomQueues,
  overviewStatusChip,
  renderProgressLabel,
  rewriteQueueLabel,
} from "../src/studio/overview";

const SOURCE_ID = "11111111-1111-1111-1111-111111111111";
const TOPIC_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const TOPIC_B = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const DRAFT_IN_WEEK = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const DRAFT_NEXT_WEEK = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";

async function seedPostedDrafts(sql: Awaited<ReturnType<typeof createTestSql>>) {
  await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
    SOURCE_ID,
    "Contoh",
    "https://example.com/feed",
    "ID",
  ]);
  await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
    TOPIC_A,
    SOURCE_ID,
    "Satu",
    "https://example.com/a",
  ]);
  await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
    TOPIC_B,
    SOURCE_ID,
    "Dua",
    "https://example.com/b",
  ]);
  const draftCols = `id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, posted_at`;
  await sql.rows(
    `insert into drafts (${draftCols}) values ($1,$2,'posted','teaser_bio','serif','[]'::jsonb,'c','[]'::jsonb,'[]'::jsonb,$3,$4)`,
    [DRAFT_IN_WEEK, TOPIC_A, "code1", "2026-10-28T02:00:00Z"],
  );
  await sql.rows(
    `insert into drafts (${draftCols}) values ($1,$2,'posted','teaser_bio','serif','[]'::jsonb,'c','[]'::jsonb,'[]'::jsonb,$3,$4)`,
    [DRAFT_NEXT_WEEK, TOPIC_B, "code2", "2026-11-01T17:00:00Z"],
  );
}

describe("overview funnel", () => {
  it("shows the Gemini quota pause instead of AI aktif", () => {
    const pause = "Kuota Gemini habis, lanjut otomatis pukul 13:59 WIB, 31 Okt";
    expect(
      overviewStatusChip({
        awake: true,
        workStart: "07:00",
        workEnd: "22:00",
        geminiPause: pause,
      }),
    ).toBe(pause);
    expect(
      overviewStatusChip({
        awake: true,
        workStart: "07:00",
        workEnd: "22:00",
        geminiPause: null,
      }),
    ).toBe("AI aktif · jam kerja 07:00–22:00 WIB");
  });

  it("labels the rewrite queue and how many review slides are drawn", () => {
    expect(rewriteQueueLabel(55)).toBe("55 antre tulis ulang");
    expect(renderProgressLabel(84, 102, 18)).toBe("84 dari 102 gambar selesai · 18 dalam antrian");
    expect(renderProgressLabel(102, 102, 0)).toBe("102 dari 102 gambar selesai");
  });

  it("counts open rewrites and unfinished review renders", async () => {
    const sql = await createTestSql();
    await seedPostedDrafts(sql);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, text_dirty)
       values ($1,$2,'needs_review','carousel_full','berita_pro','[]'::jsonb,'c','[]'::jsonb,'[]'::jsonb,'rev1',true)`,
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3", TOPIC_A],
    );
    const now = new Date("2026-10-30T06:00:00Z");
    await sql.rows(
      `insert into jobs (id, name, payload, run_at, manual)
       values
         ($1, 'copywriter.write', $2::jsonb, $3, true),
         ($4, 'designer.render', $5::jsonb, $3, true),
         ($6, 'copywriter.write', $2::jsonb, $3, true)`,
      [
        "11111111-1111-4111-8111-111111111111",
        JSON.stringify({ topicId: TOPIC_A, regenerateDemo: true }),
        now,
        "22222222-2222-4222-8222-222222222222",
        JSON.stringify({ draftId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3" }),
        "33333333-3333-4333-8333-333333333333",
      ],
    );
    await sql.rows("update jobs set finished_at = $1 where id = $2", [
      now,
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(await newsroomQueues(sql)).toEqual({
      rewriteQueue: 1,
      renderOpen: 1,
      renderDone: 0,
      reviewDrafts: 1,
    });
  });

  it("counts posted drafts only within the current Jakarta week, end exclusive", async () => {
    const sql = await createTestSql();
    await seedPostedDrafts(sql);
    const funnel = await funnelCounts(sql, new Date("2026-10-28T02:00:00Z"));
    expect(funnel.postedThisWeek).toBe(1);
  });
});
