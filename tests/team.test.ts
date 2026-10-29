import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { verifyPassword } from "../src/auth/password";
import { inviteUser, listUsers } from "../src/studio/team";

describe("team", () => {
  it("creates a social media user and shows the password only once", async () => {
    const sql = await createTestSql();
    const created = await inviteUser(sql, "admin", {
      name: "Sari",
      email: "sari@redaksi.local",
      role: "social_media",
    });
    expect(created.password).toHaveLength(16);
    const users = await listUsers(sql);
    expect(users[0]).toMatchObject({ email: "sari@redaksi.local", role: "social_media" });
    expect(JSON.stringify(users)).not.toContain(created.password);
    const stored = await sql.rows<{ password_hash: string }>("select password_hash from users");
    expect(await verifyPassword(created.password, stored[0].password_hash)).toBe(true);
    await expect(
      inviteUser(sql, "social_media", { name: "X", email: "x@redaksi.local", role: "viewer" }),
    ).rejects.toThrow(/forbidden/);
  });
});
