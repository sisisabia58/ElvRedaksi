import { describe, expect, it } from "vitest";
import { DemoLlm, ScriptedLlm } from "../src/llm/provider";
import { scoreTopic } from "../src/agents/analyst";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { runAnalyst } from "../src/jobs/handlers";
import { listTopics } from "../src/studio/topics";

describe("analyst", () => {
  it("rejects a score that is not five integers", () => {
    expect(() =>
      scoreTopic(
        JSON.stringify({
          aspects: { relevansi: 80 },
          tags: [],
          sensitive: false,
          blocked: false,
          reason: "",
        }),
      ),
    ).toThrow();
  });

  it("passes a high score, flags sensitive, and skips a hard ban", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const source = "11111111-1111-1111-1111-111111111111";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      source,
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    async function topic(id: string, title: string) {
      await sql.rows(
        "insert into topics (id, source_id, title, url, summary) values ($1,$2,$3,$4,$5)",
        [id, source, title, `https://news.example/${id}`, "cuplikan"],
      );
    }
    await topic("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "Biasa");
    await topic("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", "FIXTURE:low");
    await topic("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3", "FIXTURE:sensitive");
    const llm = new DemoLlm();
    await runAnalyst({
      sql,
      payload: { topicId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1" },
      manual: true,
      now: new Date(),
      llm,
    });
    await runAnalyst({
      sql,
      payload: { topicId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2" },
      manual: true,
      now: new Date(),
      llm,
    });
    await runAnalyst({
      sql,
      payload: { topicId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3" },
      manual: true,
      now: new Date(),
      llm,
    });
    const passed = await listTopics(sql, { filter: "passed", sort: "score", q: "" });
    expect(passed.map((t) => t.title).sort()).toEqual(["Biasa", "FIXTURE:sensitive"]);
    expect(passed.find((t) => t.title === "FIXTURE:sensitive")?.sensitive).toBe(true);
    const skipped = await listTopics(sql, { filter: "skipped", sort: "new", q: "" });
    expect(skipped.map((t) => t.title)).toEqual(["FIXTURE:low"]);
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'analis'");
    expect(log.at(-1)?.message).toBe("Menilai 1 topik, 1 lolos ambang skor 70");
    const queued = await sql.rows<{ name: string; manual: boolean }>(
      "select name, manual from jobs where name = 'copywriter.write'",
    );
    expect(queued).toHaveLength(2);
    expect(queued.every((job) => job.manual === false)).toBe(true);
  });

  it("logs only failure activity when the score JSON is invalid", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const source = "22222222-2222-2222-2222-222222222222";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      source,
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows(
      "insert into topics (id, source_id, title, url, summary) values ($1,$2,$3,$4,$5)",
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
        source,
        "Rusak",
        "https://news.example/bad",
        "cuplikan",
      ],
    );
    const llm = new ScriptedLlm(["{not valid json"]);
    await runAnalyst({
      sql,
      payload: { topicId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1" },
      manual: true,
      now: new Date(),
      llm,
    });
    const log = await sql.rows<{ message: string }>(
      "select message from activity where agent = 'analis' order by created_at",
    );
    expect(log.map((row) => row.message)).toEqual(['Gagal menilai "Rusak"']);
  });
});
