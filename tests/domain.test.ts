import { describe, expect, it } from "vitest";
import { assertTransition } from "../src/domain/status";
import { greeting, isWithinWorkHours } from "../src/domain/time";
import { totalScore, verdict } from "../src/domain/score";
import { deltaPct, engagementRate, formatUsd } from "../src/domain/metrics";
import { makeShortCode } from "../src/domain/code";

const even = { relevansi: 20, emosi: 20, kebaruan: 20, timing: 10, shareability: 10 };

describe("draft gate", () => {
  it("lets a worker publish only a draft a human already scheduled", () => {
    expect(() => assertTransition("worker", "needs_review", "posting")).toThrow(
      /publish requires human approval/,
    );
    expect(() => assertTransition("worker", "scheduled", "posting")).not.toThrow();
    expect(() => assertTransition("worker", "posting", "posted")).not.toThrow();
    expect(() => assertTransition("worker", "posting", "failed")).not.toThrow();
  });

  it("requires the manual flag to skip the API", () => {
    expect(() => assertTransition("human", "needs_review", "posted")).toThrow(/manual/);
    expect(() => assertTransition("human", "needs_review", "posted", true)).not.toThrow();
    expect(() => assertTransition("human", "posted", "needs_review")).toThrow(/illegal/);
  });
});

describe("work hours", () => {
  it("uses Asia/Jakarta and treats the end as exclusive", () => {
    expect(isWithinWorkHours(new Date("2026-10-28T00:30:00Z"), "07:00", "22:00")).toBe(true);
    expect(isWithinWorkHours(new Date("2026-10-28T00:00:00Z"), "07:00", "22:00")).toBe(true);
    expect(isWithinWorkHours(new Date("2026-10-27T15:00:00Z"), "07:00", "22:00")).toBe(false);
    expect(greeting(new Date("2026-10-28T00:30:00Z"))).toBe("pagi");
    expect(greeting(new Date("2026-10-28T06:00:00Z"))).toBe("siang");
    expect(greeting(new Date("2026-10-28T11:00:00Z"))).toBe("sore");
    expect(greeting(new Date("2026-10-28T15:00:00Z"))).toBe("malam");
  });
});

describe("score and metrics", () => {
  it("sums five aspects of 0 to 20 and passes at 70", () => {
    expect(totalScore(even)).toBe(80);
    expect(verdict(80, 70)).toBe("lolos");
    expect(verdict(69, 70)).toBe("dilewati");
    expect(() => totalScore({ ...even, relevansi: 21 })).toThrow(/0-20/);
  });

  it("formats ER, follower-style percents, and USD like the studio", () => {
    expect(engagementRate({ views: 0, likes: 1, comments: 0, saves: 0, shares: 0 })).toBe(0);
    expect(engagementRate({ views: 200, likes: 1, comments: 1, saves: 1, shares: 1 })).toBe(2);
    expect(deltaPct(200, 100)).toBe(100);
    expect(deltaPct(10, 0)).toBeNull();
    expect(formatUsd(0.105)).toBe("$0.105");
  });

  it("builds an unambiguous 5 character code", () => {
    expect(makeShortCode(new Uint8Array([0, 0, 0, 0, 0]))).toBe("aaaaa");
    expect(makeShortCode(new Uint8Array([1, 2, 3, 4, 5]))).toHaveLength(5);
  });
});
