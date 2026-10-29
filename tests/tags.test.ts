import { describe, expect, it } from "vitest";
import { scoreTopic } from "../src/agents/analyst";
import { boot } from "../src/db/boot";
import { createTestSql } from "../src/db/client";
import { normalizeCategories, normalizeCategory } from "../src/domain/tags";

describe("categories", () => {
  it("title-cases a mixed category and keeps a short acronym", () => {
    expect(normalizeCategory("EKspansi Global")).toBe("Ekspansi Global");
    expect(normalizeCategory("  AI  marketing ")).toBe("AI Marketing");
    expect(normalizeCategories(["EKspansi Global", "ekspansi global", "  "])).toEqual(["Ekspansi Global"]);
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
});
