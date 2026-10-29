import { describe, expect, it } from "vitest";
import { calculator, faq, packages } from "../src/marketing/content";

describe("marketing offer", () => {
  it("matches the inspected price math", () => {
    expect(packages.map((p) => p.price)).toEqual([5_000_000, 7_000_000]);
    expect(calculator(12)).toEqual({ team: 228_000_000, once: 5_000_000, save: 223_000_000 });
    expect(calculator(3).team).toBe(57_000_000);
    expect(faq).toHaveLength(8);
    expect(faq.some((item) => item.answer.toLowerCase().includes("tiktok"))).toBe(true);
    expect(JSON.stringify({ packages, faq })).not.toMatch(/0899|jimmimohtar|1\.480/);
  });
});
