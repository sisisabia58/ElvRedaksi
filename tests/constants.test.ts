import { describe, expect, it } from "vitest";
import {
  GRAPH_BASE,
  GRAPH_VERSION,
  INSIGHTS_INTERVAL_MS,
  PASS_THRESHOLD_DEFAULT,
  SCOUT_INTERVAL_MS,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TIME_ZONE,
} from "../src/domain/constants";

describe("constants", () => {
  it("matches the inspected product rules", () => {
    expect(PASS_THRESHOLD_DEFAULT).toBe(70);
    expect(SCOUT_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(INSIGHTS_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(SLIDE_WIDTH).toBe(1080);
    expect(SLIDE_HEIGHT).toBe(1350);
    expect(TIME_ZONE).toBe("Asia/Jakarta");
    expect(GRAPH_VERSION).toBe("v26.0");
    expect(GRAPH_BASE).toBe("https://graph.instagram.com");
  });
});
