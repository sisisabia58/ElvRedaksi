import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import type { Slide } from "../src/agents/copywriter";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "../src/domain/constants";
import { renderSlideHtml, type SlideTemplate } from "../src/render/html";

const ARTICLE_TITLE = "Contoh carousel";

const slides: { template: SlideTemplate; slide: Slide }[] = [
  {
    template: "serif",
    slide: {
      role: "cover",
      kicker: "Contoh",
      headline: ARTICLE_TITLE,
      body: "Tiga slide statis untuk halaman penjualan.",
    },
  },
  {
    template: "stabilo",
    slide: {
      role: "point",
      kicker: "Redaksi",
      headline: "Manusia yang menyetujui",
      body: "Agen mencari, menulis, dan merancang. Tidak ada yang terbit tanpa persetujuan.",
    },
  },
  {
    template: "catatan",
    slide: {
      role: "cta",
      kicker: "Sumber",
      headline: "Kredit tetap di media asal",
      body: "Setiap slide menuliskan nama sumber. Foto berita tidak diunduh.",
    },
  },
];

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    console.error("Default Chromium launch failed; retrying with --no-sandbox.");
    console.error(error);
    return chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  }
}

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), "public", "marketing");
  await mkdir(outDir, { recursive: true });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      deviceScaleFactor: 1,
    });
    for (let index = 0; index < slides.length; index++) {
      const item = slides[index]!;
      const html = renderSlideHtml({
        template: item.template,
        slide: item.slide,
        index,
        total: slides.length,
        handle: "redaksi",
        sourceName: "Buletin Contoh",
        accent: "#d7ff3a",
        focalY: 50,
        photoDataUrl: null,
      });
      await page.setContent(html, { waitUntil: "load" });
      const file = path.join(outDir, `contoh-carousel-${index + 1}.png`);
      const section = page.locator("section");
      await section.screenshot({ path: file, type: "png" });
      const written = await page.locator("section").count();
      if (written < 1) {
        throw new Error(`slide ${index + 1} did not render`);
      }
      console.log(file);
    }
    await page.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
