import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { can } from "../src/auth/rbac";
import { createSession, userForToken } from "../src/auth/session";
import { navItems } from "../src/studio/nav";
import { DemoLlm } from "../src/llm/provider";
import { changeOwnPassword } from "../src/auth/account";
import { spendSummary } from "../src/studio/spend";

describe("auth", () => {
  it("round-trips a password and hides the raw session token", async () => {
    const hash = await hashPassword("redaksi-dev-only");
    expect(hash).not.toContain("redaksi-dev-only");
    expect(await verifyPassword("redaksi-dev-only", hash)).toBe(true);
    expect(await verifyPassword("salah", hash)).toBe(false);
    const sql = await createTestSql();
    await sql.rows(
      "insert into users (id, name, email, password_hash, role) values ($1,$2,$3,$4,$5)",
      ["44444444-4444-4444-4444-444444444444", "Ade", "ade@redaksi.local", hash, "admin"],
    );
    const session = await createSession(sql, "44444444-4444-4444-4444-444444444444");
    expect(await userForToken(sql, session.token)).toMatchObject({ name: "Ade", role: "admin" });
    expect(await userForToken(sql, "bukan-token")).toBeNull();
    const stored = await sql.rows<{ token_hash: string }>("select token_hash from sessions");
    expect(stored[0].token_hash).not.toBe(session.token);
  });

  it("keeps viewers out of admin and publish actions", () => {
    expect(can("admin", "settings.write")).toBe(true);
    expect(can("social_media", "review.write")).toBe(true);
    expect(can("social_media", "brain.write")).toBe(true);
    expect(can("social_media", "source.write")).toBe(false);
    expect(can("viewer", "publish")).toBe(false);
    expect(can("kol_specialist", "studio.read")).toBe(true);
    expect(can("kol_specialist", "review.write")).toBe(false);
    expect(navItems("viewer").some((item) => item.group === "admin")).toBe(false);
    expect(navItems("admin").map((item) => item.label)).toEqual([
      "Overview",
      "Antrian Review",
      "Radar Topik",
      "Kalender",
      "Analitik",
      "Brain",
      "Sumber Topik",
      "Tim & Akses",
      "Pengaturan",
    ]);
  });

  it("sums real USD spend and ignores demo-model rows", async () => {
    const sql = await createTestSql();
    await sql.rows(
      "insert into llm_spend (id, agent, model, cost_usd, created_at) values ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10)",
      [
        "55555555-5555-5555-5555-555555555555",
        "analis",
        "demo",
        0.105,
        "2026-10-28T02:00:00Z",
        "55555555-5555-5555-5555-555555555556",
        "analis",
        "gpt-4o-mini",
        0.2,
        "2026-10-28T03:00:00Z",
      ],
    );
    const summary = await spendSummary(sql, new Date("2026-10-28T10:00:00Z"));
    expect(summary.today).toBeCloseTo(0.2);
    expect(summary.month).toBeCloseTo(0.2);
    const demo = new DemoLlm();
    expect((await demo.complete({ purpose: "score", system: "", user: "Judul: x" })).costUsd).toBe(0);
    expect((await demo.complete({ purpose: "copy", system: "", user: "Judul: x" })).costUsd).toBe(0);
  });

  it("replaces the signed-in user's password when the current one matches", async () => {
    const sql = await createTestSql();
    const hash = await hashPassword("kata-lama-123");
    await sql.rows(
      "insert into users (id, name, email, password_hash, role) values ($1,$2,$3,$4,$5)",
      ["44444444-4444-4444-4444-444444444444", "Ade", "ade@redaksi.local", hash, "admin"],
    );
    await changeOwnPassword(sql, "44444444-4444-4444-4444-444444444444", {
      current: "kata-lama-123",
      next: "kata-baru-456",
      confirm: "kata-baru-456",
    });
    const stored = await sql.rows<{ password_hash: string }>("select password_hash from users");
    expect(await verifyPassword("kata-baru-456", stored[0].password_hash)).toBe(true);
    expect(await verifyPassword("kata-lama-123", stored[0].password_hash)).toBe(false);
    await expect(
      changeOwnPassword(sql, "44444444-4444-4444-4444-444444444444", {
        current: "salah",
        next: "kata-baru-789",
        confirm: "kata-baru-789",
      }),
    ).rejects.toThrow(/saat ini salah/);
    await expect(
      changeOwnPassword(sql, "44444444-4444-4444-4444-444444444444", {
        current: "kata-baru-456",
        next: "pendek",
        confirm: "pendek",
      }),
    ).rejects.toThrow(/minimal 8/);
  }, 20_000);
});
