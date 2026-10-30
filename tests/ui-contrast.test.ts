import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { contrastRatio } from "../src/domain/contrast";
import { createTestSql } from "../src/db/client";
import { boot, DEMO_REVIEW_DRAFT_ID } from "../src/db/boot";

const AA = 4.5;
const PORT = 43127;
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO_EMAIL = "admin@redaksi.local";
const DEMO_PASSWORD = "redaksi-dev-only";

function cssToken(name: string): string {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const block = css.match(/:root,\s*\.dark\s*\{([^}]+)\}/);
  if (!block) {
    throw new Error("shadcn tokens must live in one :root, .dark block");
  }
  const line = block[1].match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!line) {
    throw new Error(`missing --${name}`);
  }
  return line[1].toLowerCase();
}

describe("studio control colors", () => {
  it("maps shadcn tokens to the dark palette with a lime primary", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/--background:\s*oklch\(1/);
    expect(cssToken("background")).toBe("#0e1014");
    expect(cssToken("foreground")).toBe("#e8eaed");
    expect(cssToken("primary")).toBe("#d7ff3a");
    expect(cssToken("primary-foreground")).toBe("#07080a");
    expect(cssToken("destructive")).toBe("#f87171");

    const pairs: Array<[string, string, string]> = [
      ["primary label", cssToken("primary-foreground"), cssToken("primary")],
      ["body text", cssToken("foreground"), cssToken("background")],
      ["secondary label", cssToken("secondary-foreground"), cssToken("secondary")],
      ["disabled label", cssToken("shadcn-muted-foreground"), cssToken("background")],
      ["destructive label", cssToken("destructive"), cssToken("background")],
      ["popover text", cssToken("popover-foreground"), cssToken("popover")],
    ];
    for (const [label, fg, bg] of pairs) {
      expect(contrastRatio(fg, bg), label).toBeGreaterThanOrEqual(AA);
    }
    expect(contrastRatio("#e8eaed", "#d7ff3a")).toBeLessThan(AA);
  });

  it("keeps outline text explicit and disabled buttons a solid dark pill", () => {
    const button = readFileSync(new URL("../components/ui/button.tsx", import.meta.url), "utf8");
    expect(button).toContain("text-foreground");
    expect(button).toContain("border-destructive");
    expect(button).toContain("disabled:bg-[var(--panel)]!");
    expect(button).toContain("disabled:text-[var(--muted)]!");
    expect(button).not.toContain("disabled:opacity-50");
    expect(button).not.toContain("dark:bg-input/30");

    const radar = readFileSync(new URL("../app/(studio)/radar/radar-panel.tsx", import.meta.url), "utf8");
    const analitik = readFileSync(new URL("../app/(studio)/analitik/page.tsx", import.meta.url), "utf8");
    expect(radar).not.toContain("bg-[var(--accent)] text-[var(--ink)]");
    expect(analitik).not.toContain("bg-[var(--accent)] text-[var(--ink)]");
    expect(radar).toContain("bg-[var(--accent)] text-[var(--bg)]");
    expect(analitik).toContain("bg-[var(--accent)] text-[var(--bg)]");
  });

  it("seeds a review draft and both toggle states for local demo", async () => {
    const previousNode = process.env.NODE_ENV;
    const previousSeed = process.env.SEED_DEMO;
    process.env.NODE_ENV = "development";
    process.env.SEED_DEMO = "1";
    try {
      const sql = await createTestSql();
      await boot(sql);
      const drafts = await sql.rows<{ id: string }>("select id from drafts");
      const toggles = await sql.rows<{ enabled: boolean }>("select enabled from sources order by enabled");
      expect(drafts.map((row) => row.id)).toEqual([DEMO_REVIEW_DRAFT_ID]);
      expect(toggles.map((row) => row.enabled)).toEqual([false, true]);
    } finally {
      if (previousNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNode;
      if (previousSeed === undefined) delete process.env.SEED_DEMO;
      else process.env.SEED_DEMO = previousSeed;
    }
  });

  it("skips the local preview seed in production", async () => {
    const previousNode = process.env.NODE_ENV;
    const previousSeed = process.env.SEED_DEMO;
    process.env.NODE_ENV = "production";
    process.env.SEED_DEMO = "1";
    try {
      const sql = await createTestSql();
      await boot(sql);
      const drafts = await sql.rows<{ id: string }>("select id from drafts");
      const users = await sql.rows<{ id: string }>("select id from users");
      expect(drafts).toEqual([]);
      expect(users).toEqual([]);
    } finally {
      if (previousNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNode;
      if (previousSeed === undefined) delete process.env.SEED_DEMO;
      else process.env.SEED_DEMO = previousSeed;
    }
  });
});

type Problem = { page: string; text: string; detail: string };

function startDevServer(): { child: ChildProcess; ready: Promise<void>; log: () => string } {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  env.SEED_DEMO = "1";
  env.NODE_ENV = "development";
  env.META_PROVIDER = "fake";
  const chunks: string[] = [];
  const child = spawn("npx", ["next", "dev", "--port", String(PORT)], {
    cwd: new URL("..", import.meta.url).pathname,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dev server did not start")), 90_000);
    const onData = (buf: Buffer) => {
      chunks.push(buf.toString());
      if (chunks.join("").includes("Ready")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`dev server exited ${code}`));
    });
  });
  return { child, ready, log: () => chunks.join("").slice(-2000) };
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function measure(page: Page, label: string): Promise<Problem[]> {
  const found = await page.evaluate(() => {
    function parse(input: string): { r: number; g: number; b: number; a: number } | null {
      const match = input.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
      if (!match) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: match[4] === undefined ? 1 : Number(match[4]),
      };
    }
    function composite(
      fg: { r: number; g: number; b: number; a: number },
      bg: { r: number; g: number; b: number; a: number },
    ) {
      const a = fg.a + bg.a * (1 - fg.a);
      const mix = (f: number, b: number) => (a === 0 ? 0 : (f * fg.a + b * bg.a * (1 - fg.a)) / a);
      return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
    }
    function channel(value: number): number {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }
    function luminance(color: { r: number; g: number; b: number }): number {
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    }
    function ratio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }): number {
      const lighter = Math.max(luminance(fg), luminance(bg));
      const darker = Math.min(luminance(fg), luminance(bg));
      return (lighter + 0.05) / (darker + 0.05);
    }
    function backgroundOf(el: Element): { r: number; g: number; b: number; a: number } {
      const chain: Element[] = [];
      let node: Element | null = el;
      while (node) {
        chain.push(node);
        node = node.parentElement;
      }
      let acc = { r: 7, g: 8, b: 10, a: 1 };
      for (const layer of chain.reverse()) {
        const bg = parse(getComputedStyle(layer).backgroundColor);
        if (bg && bg.a > 0) acc = composite(bg, acc);
      }
      return acc;
    }
    function visible(el: Element): boolean {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2;
    }
    function hex(color: { r: number; g: number; b: number }): string {
      const part = (n: number) => Math.round(n).toString(16).padStart(2, "0");
      return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
    }

    const problems: { text: string; detail: string }[] = [];
    const selector = [
      "button",
      "a.rounded-full",
      "[data-slot='badge']",
      "[data-switch-label]",
      "[role='switch']",
    ].join(",");
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el)) continue;
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (el.getAttribute("role") === "switch") {
        const knob = el.querySelector("[data-switch-knob]");
        if (!knob) {
          problems.push({ text: text || "switch", detail: "missing knob" });
          continue;
        }
        const track = backgroundOf(el);
        const knobBg = parse(getComputedStyle(knob).backgroundColor);
        if (!knobBg) continue;
        const knobRatio = ratio(knobBg, track);
        if (knobRatio < 3) {
          problems.push({
            text: text || "switch",
            detail: `knob ${knobRatio.toFixed(2)}:1`,
          });
        }
        const checked = el.getAttribute("aria-checked") === "true";
        const translate = getComputedStyle(knob).translate;
        const transform = getComputedStyle(knob).transform;
        const matrix = transform.match(/matrix\(([^)]+)\)/);
        const raw = translate && translate !== "none" ? parseFloat(translate) : matrix ? Number(matrix[1].split(",")[4]) : 0;
        const tx = translate?.includes("rem") ? raw * 16 : raw;
        if (checked && tx < 8) {
          problems.push({ text: "switch on", detail: `knob tx ${tx}` });
        }
        if (!checked && tx > 4) {
          problems.push({ text: "switch off", detail: `knob tx ${tx}` });
        }
        continue;
      }
      const fg = parse(getComputedStyle(el).color);
      if (!fg) continue;
      const bg = backgroundOf(el);
      const solid = composite(fg, bg);
      const value = ratio(solid, bg);
      if (value < 4.5) {
        problems.push({
          text: text || el.tagName.toLowerCase(),
          detail: `${value.toFixed(2)}:1 ${hex(solid)} on ${hex(bg)}`,
        });
      }
    }
    return problems;
  });
  return found.map((item) => ({ page: label, text: item.text, detail: item.detail }));
}

describe("rendered studio pages", () => {
  let server: ReturnType<typeof startDevServer> | undefined;
  let browser: Browser | undefined;

  afterAll(async () => {
    await browser?.close();
    if (server) await stopServer(server.child);
  });

  it(
    "keeps button, chip, and toggle text at WCAG AA",
    async () => {
      server = startDevServer();
      await server.ready;
      await mkdir("/opt/cursor/artifacts", { recursive: true });
      browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.setDefaultTimeout(60_000);

      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.locator("#email").fill(DEMO_EMAIL);
      await page.locator("#password").fill(DEMO_PASSWORD);
      await page.getByRole("button", { name: "Masuk ke HQ" }).click();
      await page.waitForURL("**/overview");

      const shots: Array<{ path: string; file: string; wait: string }> = [
        { path: `/review/${DEMO_REVIEW_DRAFT_ID}`, file: "after-review.png", wait: "Posting sekarang" },
        { path: "/radar", file: "after-radar.png", wait: "Buatkan konten" },
        { path: "/pengaturan", file: "after-pengaturan.png", wait: "Simpan koneksi" },
      ];
      const problems: Problem[] = [];
      for (const shot of shots) {
        await page.goto(`${BASE}${shot.path}`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: shot.wait }).waitFor();
        await page.screenshot({ path: `/opt/cursor/artifacts/${shot.file}`, fullPage: true });
        problems.push(...(await measure(page, shot.path)));
      }

      const rest = ["/overview", "/review", "/analitik", "/brain", "/sumber", "/kalender", "/tim"];
      for (const path of rest) {
        await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
        await page.locator("h1").first().waitFor();
        problems.push(...(await measure(page, path)));
      }

      await page.goto(`${BASE}/review`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Pilih beberapa" }).click();
      problems.push(...(await measure(page, "/review bulk")));

      await page.setViewportSize({ width: 390, height: 844 });
      for (const shot of shots) {
        await page.goto(`${BASE}${shot.path}`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: shot.wait }).waitFor();
        problems.push(...(await measure(page, `${shot.path} mobile`)));
      }

      expect(problems, server.log()).toEqual([]);
    },
    240_000,
  );
});
