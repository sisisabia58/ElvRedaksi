import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { createNote, deleteNote, listBrain, saveBrain } from "../src/studio/brain";
import { getSettings, saveInstagramToken, saveSettings } from "../src/studio/settings";

describe("brain and settings", () => {
  it("lets an editor edit brain and blocks deleting a locked doc", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await saveBrain(sql, "social_media", { slug: "01-brand-voice", body: "Lebih pendek." });
    const docs = await listBrain(sql);
    expect(docs.find((d) => d.slug === "01-brand-voice")?.body).toBe("Lebih pendek.");
    await expect(deleteNote(sql, "admin", "01-brand-voice")).rejects.toThrow(/terkunci/);
    const note = await createNote(sql, "admin", "Sudut kampus");
    expect(note.slug.startsWith("catatan-")).toBe(true);
    await deleteNote(sql, "admin", note.slug);
    await expect(saveBrain(sql, "viewer", { slug: "01-brand-voice", body: "x" })).rejects.toThrow(/forbidden/);
  });

  it("saves brand fields and never returns the Instagram token", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await saveSettings(sql, "admin", {
      name: "Meja",
      handle: "redaksi_meja",
      initial: "M",
      accent: "#d7ff3a",
      kicker: "Catatan",
      workStart: "08:00",
      workEnd: "21:00",
      passThreshold: 75,
      defaultFormat: "carousel_full",
      defaultTemplate: "stabilo",
      slideCount: 3,
      publicBaseUrl: "https://studio.example.com",
    });
    await saveInstagramToken(sql, "admin", {
      igUserId: "1789",
      accessToken: "super-secret",
      username: "meja",
    });
    const settings = await getSettings(sql);
    expect(settings.passThreshold).toBe(75);
    expect(settings.handle).toBe("redaksi_meja");
    expect(settings.igUsername).toBe("meja");
    expect(JSON.stringify(settings)).not.toContain("super-secret");
    await expect(
      saveInstagramToken(sql, "admin", {
        igUserId: "1789",
        accessToken: "token",
        username: "   ",
      }),
    ).rejects.toThrow(/Nama pengguna Instagram wajib diisi/);
    await expect(saveSettings(sql, "social_media", settings)).rejects.toThrow(/forbidden/);
  });
});
