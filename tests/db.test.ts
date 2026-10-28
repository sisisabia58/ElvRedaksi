import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";

describe("schema", () => {
  it("seeds a brand, the brain vault, and rejects a second topic with the same url", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const docs = await sql.rows<{ slug: string }>("select slug from brain_docs order by slug");
    expect(docs.map((d) => d.slug)).toEqual([
      "00-baca-dulu",
      "01-brand-voice",
      "02-kriteria-viral",
      "03-aturan-caption",
      "04-topik-sensitif",
      "05-contoh-post",
      "06-aturan-carousel",
    ]);
    const brand = await sql.rows<{ handle: string; pass_threshold: number }>(
      "select handle, pass_threshold from brand where id = 1",
    );
    expect(brand[0]).toMatchObject({ handle: "redaksi", pass_threshold: 70 });
    await sql.rows(
      "insert into sources (id, name, url, lang) values ($1,$2,$3,$4)",
      ["11111111-1111-1111-1111-111111111111", "Contoh", "https://example.com/feed", "ID"],
    );
    await sql.rows(
      "insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)",
      ["22222222-2222-2222-2222-222222222222", "11111111-1111-1111-1111-111111111111", "Satu", "https://example.com/a"],
    );
    await expect(
      sql.rows(
        "insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)",
        ["33333333-3333-3333-3333-333333333333", "11111111-1111-1111-1111-111111111111", "Dua", "https://example.com/a"],
      ),
    ).rejects.toThrow();
  });
});
