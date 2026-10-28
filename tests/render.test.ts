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

const DRAFT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";

class RacingRasterizer extends FakeRasterizer {
  constructor(private readonly during: () => Promise<void>) {
    super();
  }

  async toPng(html: string): Promise<Uint8Array> {
    await this.during();
    return super.toPng(html);
  }
}

const PRIOR_ASSETS = ["prior-slide-0", "prior-slide-1"];

async function insertPriorAssets(sql: Awaited<ReturnType<typeof createTestSql>>) {
  await sql.rows(
    `insert into assets (id, draft_id, slide_index, bytes) values
      ($1, $2, 0, $3),
      ($4, $2, 1, $5)`,
    [
      "cccccccc-cccc-cccc-cccc-ccccccccccc1",
      DRAFT_ID,
      Buffer.from(PRIOR_ASSETS[0]),
      "cccccccc-cccc-cccc-cccc-ccccccccccc2",
      Buffer.from(PRIOR_ASSETS[1]),
    ],
  );
}

function assetText(value: unknown): string {
  if (typeof value === "string") {
    return value.startsWith("\\x") ? Buffer.from(value.slice(2), "hex").toString("utf8") : value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8");
  }
  throw new Error(`unexpected asset bytes: ${Object.prototype.toString.call(value)}`);
}

async function expectPriorAssets(sql: Awaited<ReturnType<typeof createTestSql>>) {
  const rows = await sql.rows<{ slide_index: number; bytes: unknown }>(
    "select slide_index, bytes from assets order by slide_index",
  );
  expect(rows.map((row) => ({ slide_index: row.slide_index, bytes: assetText(row.bytes) }))).toEqual([
    { slide_index: 0, bytes: PRIOR_ASSETS[0] },
    { slide_index: 1, bytes: PRIOR_ASSETS[1] },
  ]);
}

async function seedDesignerDraft(status: "drafted" | "needs_review") {
  const sql = await createTestSql();
  await seedDefaults(sql);
  await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
    "11111111-1111-1111-1111-111111111111",
    "Contoh",
    "https://news.example/feed",
    "ID",
  ]);
  await sql.rows(
    "insert into topics (id, source_id, title, url, state) values ($1,$2,$3,$4,'drafted')",
    [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      "11111111-1111-1111-1111-111111111111",
      "Iklan",
      "https://news.example/a",
    ],
  );
  await sql.rows(
    `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, text_dirty)
     values ($1,$2,$3,'teaser_bio','serif',$4::jsonb,'cap',$5::jsonb,$6::jsonb,'abcde',false)`,
    [
      DRAFT_ID,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      status,
      JSON.stringify(slides),
      JSON.stringify(["iklan", "medsos", "sumber"]),
      JSON.stringify(["Alt satu cukup", "Alt dua cukup"]),
    ],
  );
  return sql;
}

describe("designer", () => {
  it("renders a 4:5 teaser without a remote image", () => {
    expect(slidesForFormat("teaser_bio", slides).map((s) => s.role)).toEqual(["cover", "cta"]);
    expect(slidesForFormat("carousel_full", slides).map((s) => s.role)).toEqual(["cover", "point", "point"]);
    const carouselOnly = slides.filter((s) => s.role !== "cta");
    expect(slidesForFormat("carousel_full", carouselOnly)).toHaveLength(3);
    expect(() => slidesForFormat("carousel_full", [slides[0]])).toThrow(/jumlah slide tidak valid/);
    expect(() => slidesForFormat("teaser_bio", slides.filter((s) => s.role !== "cta"))).toThrow(
      /slide tidak lengkap/,
    );
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
    const withPhoto = renderSlideHtml({
      template: "serif",
      slide: slides[0],
      index: 0,
      total: 1,
      handle: "redaksi",
      sourceName: "Contoh",
      accent: "#d7ff3a",
      focalY: 50,
      photoDataUrl: 'data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)',
    });
    expect(withPhoto).not.toContain("<img");
    const validPhoto = renderSlideHtml({
      template: "serif",
      slide: slides[0],
      index: 0,
      total: 1,
      handle: "redaksi",
      sourceName: "Contoh",
      accent: "#d7ff3a",
      focalY: 50,
      photoDataUrl: "data:image/png;base64,iVBORw0KGgo",
    });
    expect(validPhoto).toContain("<img");
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

  it("rasterizes an uploaded cover photo from slide json", async () => {
    const coverPhoto = "data:image/png;base64,iVBORw0KGgo";
    const slidesWithPhoto = [{ ...slides[0], photoDataUrl: coverPhoto }, ...slides.slice(1)];
    const captured: string[] = [];
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, state) values ($1,$2,$3,$4,'drafted')",
      [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        "11111111-1111-1111-1111-111111111111",
        "Iklan",
        "https://news.example/a",
      ],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, focal_y)
       values ($1,$2,'drafted','teaser_bio','serif',$3::jsonb,'cap',$4::jsonb,$5::jsonb,'abcde',72)`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        JSON.stringify(slidesWithPhoto),
        JSON.stringify(["iklan"]),
        JSON.stringify(["Alt satu cukup", "Alt dua cukup"]),
      ],
    );
    await runDesigner({
      sql,
      payload: { draftId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1" },
      manual: true,
      now: new Date(),
      rasterizer: {
        toPng: async (html) => {
          captured.push(html);
          return Buffer.from("png");
        },
        close: async () => {},
      },
    });
    expect(captured[0]).toContain("<img");
    expect(captured[0]).toContain(coverPhoto);
    expect(captured[0]).toContain("center 72%");
    expect(captured[1]).not.toContain(coverPhoto);
  });

  it("keeps an approval that lands while the slide is rasterizing", async () => {
    const sql = await seedDesignerDraft("needs_review");
    await insertPriorAssets(sql);
    await runDesigner({
      sql,
      payload: { draftId: DRAFT_ID },
      manual: true,
      now: new Date(),
      rasterizer: new RacingRasterizer(async () => {
        await sql.rows(
          `update drafts set status = 'approved', updated_at = updated_at + interval '1 second' where id = $1`,
          [DRAFT_ID],
        );
      }),
    });
    const status = await sql.rows<{ status: string; text_dirty: boolean }>(
      "select status, text_dirty from drafts",
    );
    expect(status[0]).toMatchObject({ status: "approved", text_dirty: false });
    const log = await sql.rows("select id from activity where agent = 'designer'");
    expect(log).toHaveLength(0);
    await expectPriorAssets(sql);
  });

  it("keeps text_dirty when a newer save lands while the slide is rasterizing", async () => {
    const sql = await seedDesignerDraft("drafted");
    await insertPriorAssets(sql);
    await expect(
      runDesigner({
        sql,
        payload: { draftId: DRAFT_ID },
        manual: true,
        now: new Date(),
        rasterizer: new RacingRasterizer(async () => {
          await sql.rows(
            `update drafts set text_dirty = true, updated_at = updated_at + interval '1 second' where id = $1`,
            [DRAFT_ID],
          );
        }),
      }),
    ).rejects.toThrow(/did not enter the review queue/);
    const status = await sql.rows<{ status: string; text_dirty: boolean }>(
      "select status, text_dirty from drafts",
    );
    expect(status[0]).toMatchObject({ status: "drafted", text_dirty: true });
    const log = await sql.rows("select id from activity where agent = 'designer'");
    expect(log).toHaveLength(0);
    await expectPriorAssets(sql);
  });

  it("retries a first render when the draft changes during toPng", async () => {
    const sql = await seedDesignerDraft("drafted");
    await insertPriorAssets(sql);
    await expect(
      runDesigner({
        sql,
        payload: { draftId: DRAFT_ID },
        manual: true,
        now: new Date(),
        rasterizer: new RacingRasterizer(async () => {
          await sql.rows(
            `update drafts set updated_at = updated_at + interval '1 second' where id = $1`,
            [DRAFT_ID],
          );
        }),
      }),
    ).rejects.toThrow(/did not enter the review queue/);
    const status = await sql.rows<{ status: string; text_dirty: boolean; error: string | null }>(
      "select status, text_dirty, error from drafts",
    );
    expect(status[0]).toMatchObject({ status: "drafted", text_dirty: false, error: null });
    const log = await sql.rows("select id from activity where agent = 'designer'");
    expect(log).toHaveLength(0);
    await expectPriorAssets(sql);
  });

  it("does not stamp a raster error onto a row that changed during the failure", async () => {
    const sql = await seedDesignerDraft("needs_review");
    await insertPriorAssets(sql);
    await expect(
      runDesigner({
        sql,
        payload: { draftId: DRAFT_ID },
        manual: true,
        now: new Date(),
        rasterizer: {
          async toPng() {
            await sql.rows(
              `update drafts set updated_at = updated_at + interval '1 second', text_dirty = true where id = $1`,
              [DRAFT_ID],
            );
            throw new Error("raster failed late");
          },
        },
      }),
    ).rejects.toThrow(/raster failed late/);
    const status = await sql.rows<{ error: string | null; text_dirty: boolean; status: string }>(
      "select error, text_dirty, status from drafts",
    );
    expect(status[0]).toMatchObject({ error: null, text_dirty: true, status: "needs_review" });
    const log = await sql.rows("select id from activity where agent = 'designer'");
    expect(log).toHaveLength(0);
    await expectPriorAssets(sql);
  });

  it("keeps previous assets when the rasterizer throws", async () => {
    const sql = await seedDesignerDraft("drafted");
    await insertPriorAssets(sql);
    let calls = 0;
    await expect(
      runDesigner({
        sql,
        payload: { draftId: DRAFT_ID },
        manual: true,
        now: new Date(),
        rasterizer: {
          async toPng() {
            calls += 1;
            if (calls > 1) {
              throw new Error("raster failed");
            }
            return Buffer.from("new-png");
          },
        },
      }),
    ).rejects.toThrow(/raster failed/);
    const status = await sql.rows<{ status: string; text_dirty: boolean; error: string | null }>(
      "select status, text_dirty, error from drafts",
    );
    expect(status[0]).toMatchObject({ status: "drafted", text_dirty: false, error: "raster failed" });
    const log = await sql.rows("select id from activity where agent = 'designer'");
    expect(log).toHaveLength(0);
    await expectPriorAssets(sql);
  });

  it("keeps text_dirty when a newer save lands during a re-render", async () => {
    const sql = await seedDesignerDraft("needs_review");
    await insertPriorAssets(sql);
    await runDesigner({
      sql,
      payload: { draftId: DRAFT_ID },
      manual: true,
      now: new Date(),
      rasterizer: new RacingRasterizer(async () => {
        await sql.rows(
          `update drafts set text_dirty = true, updated_at = updated_at + interval '1 second' where id = $1`,
          [DRAFT_ID],
        );
      }),
    });
    const status = await sql.rows<{ status: string; text_dirty: boolean }>(
      "select status, text_dirty from drafts",
    );
    expect(status[0]).toMatchObject({ status: "needs_review", text_dirty: true });
    await expectPriorAssets(sql);
  });
});
