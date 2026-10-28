import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { funnelCounts } from "../src/studio/overview";

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
  it("counts posted drafts only within the current Jakarta week, end exclusive", async () => {
    const sql = await createTestSql();
    await seedPostedDrafts(sql);
    const funnel = await funnelCounts(sql, new Date("2026-10-28T02:00:00Z"));
    expect(funnel.postedThisWeek).toBe(1);
  });
});
