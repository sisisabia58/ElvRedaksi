import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { can } from "../src/auth/rbac";
import { createSession, userForToken } from "../src/auth/session";
import { navItems } from "../src/studio/nav";
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

  it("sums USD spend for today and the month in Jakarta", async () => {
    const sql = await createTestSql();
    await sql.rows(
      "insert into llm_spend (id, agent, model, cost_usd, created_at) values ($1,$2,$3,$4,$5)",
      ["55555555-5555-5555-5555-555555555555", "analis", "demo", 0.105, "2026-10-28T02:00:00Z"],
    );
    const summary = await spendSummary(sql, new Date("2026-10-28T10:00:00Z"));
    expect(summary.today).toBeCloseTo(0.105);
    expect(summary.month).toBeCloseTo(0.105);
  });
});
