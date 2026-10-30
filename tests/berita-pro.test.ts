import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parseCopy } from "../src/agents/copywriter";
import { boot, migrateStoredBrand } from "../src/db/boot";
import { createTestSql } from "../src/db/client";
import { COVER_NAVY, DEFAULT_ACCENT, PAPER } from "../src/domain/brand";
import { contrastRatio } from "../src/domain/contrast";
import { runDesigner } from "../src/jobs/handlers";
import { PlaywrightRasterizer } from "../src/render/raster";
import { fitSlideBody } from "../src/render/fit-body";
import {
  bodyPx,
  coverHeadlinePx,
  innerChromeOverlaps,
  innerHeadlinePx,
  pageCounter,
  renderBeritaProHtml,
  wordmarkBox,
} from "../src/render/berita-pro";
import { renderSlideHtml, slidesForFormat } from "../src/render/html";
import { queueBeritaProRerender } from "../src/studio/rerender-template";

const slides = [
  { role: "cover" as const, kicker: "Bisnis", headline: "Kenapa harga beras naik?", body: "Pembuka singkat." },
  { role: "point" as const, kicker: "Pasar", headline: "Stok di gudang utama masih ada", body: "Cuplikan menyebut stok cukup di gudang utama." },
  {
    role: "point" as const,
    kicker: "Harga",
    headline: "Beberapa kota masih bergerak",
    body: "Harga di beberapa kota besar belum rata.",
  },
  { role: "cta" as const, kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Artikel ANTARA." },
];

const longHeadline =
  "Pemerintah memastikan stok beras nasional masih aman meski harga di beberapa kota besar terus bergerak naik pekan ini juga";

function slideInput(
  index: number,
  overrides: Partial<Parameters<typeof renderBeritaProHtml>[0]> = {},
) {
  return {
    slide: index === 0 ? { ...slides[0], headline: slides[0].headline } : slides[index],
    index,
    total: 3,
    handle: "",
    sourceName: "ANTARA",
    accent: DEFAULT_ACCENT,
    focalY: 40,
    photoDataUrl: null,
    logoDataUrl: null,
    initial: "A",
    ...overrides,
  };
}

describe("berita pro", () => {
  it("keeps default colours inside WCAG text contrast", () => {
    expect(contrastRatio("#FFFFFF", COVER_NAVY)).toBeGreaterThan(7);
    expect(contrastRatio("#FFFFFF", DEFAULT_ACCENT)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(DEFAULT_ACCENT, PAPER)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(DEFAULT_ACCENT, COVER_NAVY)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(COVER_NAVY, PAPER)).toBeGreaterThan(7);
  });

  it("shrinks long headlines and keeps the last slide free of the swipe pill", () => {
    expect(coverHeadlinePx("Kenapa harga beras naik?")).toBeGreaterThan(coverHeadlinePx(longHeadline));
    expect(innerHeadlinePx("Stok aman")).toBeGreaterThan(innerHeadlinePx(longHeadline));
    expect(bodyPx("Pendek.")).toBe(48);
    expect(bodyPx("Pendek.")).toBeGreaterThan(bodyPx(longHeadline.repeat(2)));
    const kkpBody =
      "Kementerian Kelautan dan Perikanan menargetkan pembangunan 2.000 Kampung Nelayan Merah Putih di seluruh Indonesia pada 2027. Sebanyak 169 calon lokasi di 16 kabupaten dan kota dipersiapkan di Sulawesi Tenggara.";
    const fitted = fitSlideBody(kkpBody);
    expect(fitted.text).toBe(kkpBody);
    expect(fitted.text.endsWith(".")).toBe(true);
    expect(fitted.size).toBeLessThan(48);
    expect(fitted.size).toBeGreaterThanOrEqual(32);
    const tooLong = `${"Kalimat pertama cukup panjang untuk mengisi beberapa baris pada slide isi berita. ".repeat(4)}Kalimat terakhir tidak muat.`;
    const clamped = fitSlideBody(tooLong.trim());
    expect(clamped.text.endsWith(".")).toBe(true);
    expect(clamped.text.length).toBeLessThan(tooLong.trim().length);
    expect(tooLong.trim().startsWith(clamped.text)).toBe(true);
    expect(clamped.text).not.toMatch(/\bdi$/);
    expect(pageCounter(1, 3)).toBe("02 / 03");

    const cover = renderBeritaProHtml(
      slideInput(0, { slide: { ...slides[0], headline: "Kenapa harga beras naik?" } }),
    );
    const longCover = renderBeritaProHtml(slideInput(0, { slide: { ...slides[0], headline: longHeadline } }));
    expect(cover).toContain(`font-size:${coverHeadlinePx("Kenapa harga beras naik?")}px`);
    expect(longCover).toContain(`font-size:${coverHeadlinePx(longHeadline)}px`);
    expect(cover).toContain("overflow:hidden");
    expect(cover).toContain(COVER_NAVY);
    expect(cover).not.toContain("#000000");
    expect(cover).toContain("GESER →");
    expect(cover).toContain("Bisnis");
    expect(cover).toContain("text-transform:uppercase");
    expect(cover).not.toContain("Foto:");
    expect(cover).not.toContain("Ikuti @");

    const photo =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const withPhoto = renderBeritaProHtml(slideInput(0, { photoDataUrl: photo }));
    expect(withPhoto).toContain("Foto: ANTARA");
    expect(withPhoto).toContain("mix-blend-mode:multiply");
    expect(withPhoto).toContain("brightness(1.45)");
    expect(withPhoto).toContain("height:810px");

    const sourced = renderBeritaProHtml(
      slideInput(1, {
        slide: {
          ...slides[1],
          body: "Pasokan domestik sudah tercukupi sepenuhnya. ANTARA Terkini",
        },
        sourceName: "ANTARA Terkini",
        logoDataUrl: photo,
      }),
    );
    expect(sourced).toContain("Pasokan domestik sudah tercukupi sepenuhnya.");
    expect(sourced).not.toContain("sepenuhnya. ANTARA Terkini");
    expect(sourced).toContain("Sumber: ANTARA Terkini");
    expect(sourced).toContain("line-height:1.48");
    expect(sourced).toContain('data-slide-body="1"');
    expect(sourced).not.toMatch(/data-slide-body="1"[^>]*overflow/);
    expect(sourced).not.toMatch(/data-slide-body="1"[^>]*max-height/);
    expect(sourced).not.toContain("max-height:742px");
    const mark = wordmarkBox();
    expect(mark.top).toBeLessThan(0);
    expect(mark.height).toBe(68);
    expect(sourced).toContain(`width:${mark.width}px;height:${mark.height}px`);
    expect(sourced).toContain(`top:${mark.top}px`);

    const middle = renderSlideHtml({
      template: "berita_pro",
      ...slideInput(1),
    });
    const last = renderSlideHtml({
      template: "berita_pro",
      ...slideInput(2),
    });
    expect(middle).toContain("02 / 03");
    expect(middle).toContain("GESER →");
    expect(middle).toContain("left:72px;bottom:132px");
    expect(middle).not.toContain("bottom:52px");
    expect(innerChromeOverlaps()).toBe(false);
    const magelang = renderBeritaProHtml(
      slideInput(0, {
        slide: { ...slides[0], headline: "Pertanian Perkotaan Magelang" },
      }),
    );
    expect(magelang).toContain("line-height:1.25");
    expect(magelang).toContain('data-cover-headline="1"');
    expect(magelang).not.toMatch(/data-cover-headline="1"[^>]*overflow:\s*hidden/);
    const kkpHtml = renderBeritaProHtml(
      slideInput(1, {
        slide: { ...slides[1], body: kkpBody + " (ANTARA Terkini)" },
        sourceName: "ANTARA Terkini",
      }),
    );
    expect(kkpHtml).toContain("Sulawesi Tenggara.");
    expect(kkpHtml).not.toContain("dipersiapkan di</");
    expect(middle).toContain("Sumber: ANTARA");
    expect(middle).not.toContain("Baca selengkapnya");
    expect(last).toContain("03 / 03");
    expect(last).toContain("Baca selengkapnya di link bio");
    expect(last).not.toContain("GESER →");
    expect(last).not.toContain("Ikuti @");

    const named = renderSlideHtml({
      template: "berita_pro",
      ...slideInput(2, { handle: "analystdigest" }),
    });
    expect(named).toContain("Ikuti @analystdigest");
    expect(slidesForFormat("teaser_bio", slides, { template: "berita_pro", slideCount: 3 }).map((s) => s.role)).toEqual([
      "cover",
      "point",
      "point",
    ]);
    expect(slidesForFormat("carousel_full", slides, { template: "berita_pro", slideCount: 2 })).toHaveLength(2);
    expect(slidesForFormat("carousel_full", slides).map((s) => s.role)).toEqual(["cover", "point", "point"]);
  });

  it("renders 1080x1350 pngs and a long headline does not match a short one", async () => {
    const raster = new PlaywrightRasterizer();
    try {
      const shortPng = await raster.toPng(
        renderBeritaProHtml(slideInput(0, { slide: { ...slides[0], headline: "Kenapa harga beras naik?" } })),
      );
      const longPng = await raster.toPng(
        renderBeritaProHtml(slideInput(0, { slide: { ...slides[0], headline: longHeadline } })),
      );
      const innerPng = await raster.toPng(renderBeritaProHtml(slideInput(1)));
      for (const png of [shortPng, longPng, innerPng]) {
        const meta = await sharp(Buffer.from(png)).metadata();
        expect(meta.width).toBe(1080);
        expect(meta.height).toBe(1350);
      }
      expect(Buffer.from(shortPng).equals(Buffer.from(longPng))).toBe(false);
      const top = await sharp(Buffer.from(shortPng)).extract({ left: 8, top: 8, width: 1, height: 1 }).raw().toBuffer();
      expect(top[0]).toBeLessThan(40);
      expect(top[2]).toBeGreaterThan(top[0]);
      const paper = await sharp(Buffer.from(innerPng))
        .extract({ left: 8, top: 8, width: 1, height: 1 })
        .raw()
        .toBuffer();
      expect(paper[0]).toBeGreaterThan(200);
    } finally {
      await raster.close();
    }
  }, 20000);

  it("queues review drafts onto Berita Pro without changing status or posted rows", async () => {
    const sql = await createTestSql();
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "ANTARA",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      "11111111-1111-1111-1111-111111111111",
      "Beras",
      "https://news.example/beras",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
      "11111111-1111-1111-1111-111111111111",
      "Sudah",
      "https://news.example/sudah",
    ]);
    const payload = [
      JSON.stringify(slides),
      JSON.stringify(["beras", "pasar", "stok"]),
      JSON.stringify(["Alt satu cukup", "Alt dua cukup"]),
    ];
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'needs_review','teaser_bio','serif',$3::jsonb,'cap',$4::jsonb,$5::jsonb,'rev01')`,
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", ...payload],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'posted','teaser_bio','serif',$3::jsonb,'cap',$4::jsonb,$5::jsonb,'post1')`,
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", ...payload],
    );
    await expect(queueBeritaProRerender(sql, "social_media")).rejects.toThrow(/forbidden/);
    expect(await queueBeritaProRerender(sql, "admin")).toBe(1);
    const rows = await sql.rows<{ status: string; template: string; text_dirty: boolean }>(
      "select status, template, text_dirty from drafts order by short_code",
    );
    expect(rows).toEqual([
      { status: "posted", template: "serif", text_dirty: false },
      { status: "needs_review", template: "berita_pro", text_dirty: true },
    ]);
    const jobs = await sql.rows<{ name: string }>("select name from jobs");
    expect(jobs.map((job) => job.name)).toEqual(["designer.render"]);
  });

  it("updates the seed brand on boot and does not re-render existing drafts", async () => {
    const sql = await createTestSql();
    await sql.rows(
      `insert into brand (name, handle, initial, accent, kicker, pass_threshold, default_format, default_template)
       values ('Redaksi', 'redaksi', 'R', '#d7ff3a', 'Catatan redaksi', 70, 'teaser_bio', 'serif')`,
    );
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "ANTARA",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      "11111111-1111-1111-1111-111111111111",
      "Beras",
      "https://news.example/beras",
    ]);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, text_dirty)
       values ($1,$2,'needs_review','teaser_bio','serif',$3::jsonb,'cap','[]'::jsonb,'[]'::jsonb,'stay1',false)`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        JSON.stringify(slides),
      ],
    );
    await boot(sql);
    const brand = await sql.rows<{ name: string; handle: string; default_template: string; accent: string }>(
      "select name, handle, default_template, accent from brand",
    );
    expect(brand[0]).toMatchObject({
      name: "Analyst Digest",
      handle: "",
      default_template: "berita_pro",
      accent: DEFAULT_ACCENT,
    });
    const draft = await sql.rows<{ template: string; status: string; text_dirty: boolean }>(
      "select template, status, text_dirty from drafts",
    );
    expect(draft).toEqual([{ template: "serif", status: "needs_review", text_dirty: false }]);
    const jobs = await sql.rows<{ name: string }>("select name from jobs order by name");
    expect(jobs.map((job) => job.name)).toEqual(["insights.sync", "scout.scan"]);
  });

  it("leaves a customised brand template alone", async () => {
    const sql = await createTestSql();
    await sql.rows(
      `insert into brand (name, handle, initial, accent, kicker, pass_threshold, default_format, default_template)
       values ('Redaksi', 'redaksi', 'R', '#112233', 'Catatan', 70, 'teaser_bio', 'serif')`,
    );
    await migrateStoredBrand(sql);
    const brand = await sql.rows<{ name: string; accent: string; default_template: string; has_logo: boolean }>(
      "select name, accent, default_template, (logo is not null) as has_logo from brand",
    );
    expect(brand[0]).toMatchObject({
      name: "Redaksi",
      accent: "#112233",
      default_template: "serif",
      has_logo: true,
    });
  });

  it("still renders when the article image cannot be fetched", async () => {
    const sql = await createTestSql();
    const { seedDefaults } = await import("../src/db/seed");
    const { FakeRasterizer } = await import("../src/render/raster");
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "ANTARA",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state, image_url) values ($1,$2,$3,$4,'drafted',$5)",
      [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        "11111111-1111-1111-1111-111111111111",
        "Beras",
        "https://news.example/beras",
        "http://127.0.0.1/secret.jpg",
      ],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'drafted','teaser_bio','berita_pro',$3::jsonb,'cap',$4::jsonb,$5::jsonb,'img01')`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        JSON.stringify(slides),
        JSON.stringify(["beras", "pasar", "stok"]),
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
    expect(assets).toHaveLength(3);
    const status = await sql.rows<{ status: string }>("select status from drafts");
    expect(status[0]?.status).toBe("needs_review");
  });
});

describe("copy stays compatible with the existing checker", () => {
  it("still accepts the four-slide fixture", () => {
    const copy = parseCopy(
      JSON.stringify({
        slides,
        caption: "Ringkasan dari ANTARA. Ini bukan artikel aslinya.",
        hashtags: ["beras", "pasar", "stok"],
        altHeadlines: ["Harga beras naik?", "Stok disebut masih ada"],
      }),
      "ANTARA",
    );
    expect(copy.slides).toHaveLength(4);
    expect(copy.slides[0]?.kicker).toBe("Bisnis");
  });
});
