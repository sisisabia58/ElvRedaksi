import { describe, expect, it } from "vitest";
import { renderSlideHtml, slidesForFormat } from "../src/render/html";
import { FakeRasterizer } from "../src/render/raster";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { runDesigner } from "../src/jobs/handlers";

const slides = [
  { role: "cover" as const, kicker: "AI", headline: "Iklan baru bisa nyamar", body: "Pembuka." },
  { role: "point" as const, kicker: "Fakta", headline: "Uji coba dibuka", body: "Detail." },
  { role: "point" as const, kicker: "Dampak", headline: "Cek sumbernya", body: "Jangan salin." },
  { role: "cta" as const, kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke artikel Contoh." },
];

describe("designer", () => {
  it("renders a 4:5 teaser without a remote image", () => {
    expect(slidesForFormat("teaser_bio", slides).map((s) => s.role)).toEqual(["cover", "cta"]);
    expect(slidesForFormat("carousel_full", slides)).toHaveLength(3);
    const html = renderSlideHtml({
      template: "serif",
      slide: slides[0],
      index: 0,
      total: 2,
      handle: "redaksi",
      sourceName: "Contoh",
      accent: "#d7ff3a",
      focalY: 50,
      photoDataUrl: null,
    });
    expect(html).toContain("1080");
    expect(html).toContain("1350");
    expect(html).toContain("Sumber: Contoh");
    expect(html).toContain("@redaksi");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("stores two pngs and moves the draft to review", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111", "Contoh", "https://news.example/feed", "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state) values ($1,$2,$3,$4,'drafted')",
      ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "11111111-1111-1111-1111-111111111111", "Iklan", "https://news.example/a"],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'drafted','teaser_bio','serif',$3::jsonb,'cap',$4::jsonb,$5::jsonb,'abcde')`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        JSON.stringify(slides),
        JSON.stringify(["iklan", "medsos", "sumber"]),
        JSON.stringify(["Alt satu cukup", "Alt dua cukup"]),
      ],
    );
    await runDesigner({
      sql,
      payload: { draftId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1" },
      manual: true,
      now: new Date(),
      rasterizer: new FakeRasterizer(),
    });
    const assets = await sql.rows("select slide_index from assets order by slide_index");
    expect(assets).toHaveLength(2);
    const status = await sql.rows<{ status: string; text_dirty: boolean }>("select status, text_dirty from drafts");
    expect(status[0]).toMatchObject({ status: "needs_review", text_dirty: false });
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'designer'");
    expect(log[0].message).toBe('Gambar selesai untuk "Iklan baru bisa nyamar"');
  });
});
