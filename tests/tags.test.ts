import { describe, expect, it } from "vitest";
import { scoreTopic } from "../src/agents/analyst";
import { boot } from "../src/db/boot";
import { createTestSql } from "../src/db/client";
import { normalizeCategories, normalizeCategory, normalizeKicker } from "../src/domain/tags";

describe("categories", () => {
  it("title-cases a mixed category and keeps a short acronym", () => {
    expect(normalizeCategory("EKspansi Global")).toBe("Ekspansi Global");
    expect(normalizeCategory("  AI  marketing ")).toBe("AI Marketing");
    expect(normalizeCategories(["EKspansi Global", "ekspansi global", "  "])).toEqual(["Ekspansi Global"]);
  });

  it("title-cases the slide category the review page shows", () => {
    expect(normalizeKicker("EKspansi Global")).toBe("Ekspansi Global");
    expect(normalizeKicker("ANTARA Terkini")).toBe("Antara Terkini");
    expect(normalizeKicker("INFO LINGKUNGAN")).toBe("Info Lingkungan");
    expect(normalizeKicker("AI")).toBe("AI");
  });

  it("normalizes tags that come back from the model", () => {
    const scored = scoreTopic(
      JSON.stringify({
        aspects: { relevansi: 16, emosi: 16, kebaruan: 16, timing: 16, shareability: 16 },
        tags: ["EKspansi Global"],
        sensitive: false,
        sensitiveReason: null,
        blocked: false,
        reason: "Layak.",
      }),
    );
    expect(scored.tags).toEqual(["Ekspansi Global"]);
  });

  it("rewrites stored topic tags on boot", async () => {
    const sql = await createTestSql();
    const source = "11111111-1111-1111-1111-111111111111";
    const topic = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      source,
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, tags) values ($1,$2,$3,$4,$5::jsonb)",
      [topic, source, "Libya", "https://news.example/libya", JSON.stringify(["EKspansi Global"])],
    );
    await boot(sql);
    const rows = await sql.rows<{ tags: string[] | string }>("select tags from topics where id = $1", [topic]);
    const tags = typeof rows[0]?.tags === "string" ? JSON.parse(rows[0].tags) : rows[0]?.tags;
    expect(tags).toEqual(["Ekspansi Global"]);
  });

  it("rewrites stored slide categories on boot and leaves the draft in review", async () => {
    const sql = await createTestSql();
    const source = "11111111-1111-1111-1111-111111111111";
    const topic = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    const draft = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      source,
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, tags) values ($1,$2,$3,$4,$5::jsonb)",
      [topic, source, "Libya", "https://news.example/libya", JSON.stringify(["Bisnis"])],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'needs_review','carousel_full','serif',$3::jsonb,'caption','[]'::jsonb,'[]'::jsonb,'libya1')`,
      [
        draft,
        topic,
        JSON.stringify([
          { role: "cover", kicker: "EKspansi Global", headline: "12 Merek Kuliner Dunia Masuk Libya", body: "ANTARA Terkini" },
        ]),
      ],
    );
    await boot(sql);
    const rows = await sql.rows<{ status: string; text_dirty: boolean; slides: Array<{ kicker: string }> | string }>(
      "select status, text_dirty, slides from drafts where id = $1",
      [draft],
    );
    const slides = typeof rows[0]?.slides === "string" ? JSON.parse(rows[0].slides) : rows[0]?.slides;
    expect(rows[0]?.status).toBe("needs_review");
    expect(rows[0]?.text_dirty).toBe(true);
    expect(slides[0]?.kicker).toBe("Ekspansi Global");
    const rewriteJobs = await sql.rows<{ id: string }>(
      "select id from jobs where coalesce(payload->>'regenerateDemo', '') = 'true'",
    );
    expect(rewriteJobs).toHaveLength(0);
  });
});
