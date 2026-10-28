import { chromium, type Browser } from "playwright";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "../domain/constants";

export interface Rasterizer {
  toPng(html: string): Promise<Uint8Array>;
}

export class FakeRasterizer implements Rasterizer {
  async toPng(html: string): Promise<Uint8Array> {
    return Uint8Array.from(Buffer.from("PNG" + html.length));
  }
}

export class PlaywrightRasterizer implements Rasterizer {
  private browserPromise: Promise<Browser> | null = null;

  private async browser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch();
    }
    return this.browserPromise;
  }

  async toPng(html: string): Promise<Uint8Array> {
    const browser = await this.browser();
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
      await page.setContent(html, { waitUntil: "load" });
      const shot = await page.screenshot({ type: "png" });
      return new Uint8Array(shot);
    } finally {
      await page.close();
    }
  }
}
