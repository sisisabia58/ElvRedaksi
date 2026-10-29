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
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "11111111-1111-1111-1111-111111111111", "Iklan", "https://example.com/artikel",
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
    expect(grid.handle).toBe("");
    expect(grid.items[0]).toMatchObject({ code: "abcde", sourceName: "Contoh" });
    const prefetch = await resolveShortLink(sql, "abcde", true);
    const real = await resolveShortLink(sql, "abcde", false);
    expect(prefetch).toMatchObject({ location: "https://example.com/artikel", counted: false });
    expect(real).toMatchObject({ counted: true });
    const clicks = await sql.rows<{ click_count: number }>("select click_count from drafts");
    expect(clicks[0].click_count).toBe(1);
    expect(await resolveShortLink(sql, "tidak", false)).toBeNull();
  });

  it("does not redirect a short link whose article url is private", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
      "11111111-1111-1111-1111-111111111111",
      "Rahasia",
      "http://127.0.0.1/secret",
    ]);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, click_count)
       values ($1,$2,'posted','teaser_bio','serif','[]'::jsonb,'c','[]'::jsonb,'[]'::jsonb,'priv8',0)`,
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"],
    );
    expect(await resolveShortLink(sql, "priv8", false)).toBeNull();
    const clicks = await sql.rows<{ click_count: number }>("select click_count from drafts where short_code = 'priv8'");
    expect(clicks[0]?.click_count).toBe(0);
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
