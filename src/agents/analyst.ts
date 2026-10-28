import { z } from "zod";
import type { AspectScores } from "../domain/score";

const aspectField = z.number().int().min(0).max(20);

export const scoreSchema = z.object({
  aspects: z.object({
    relevansi: aspectField,
    emosi: aspectField,
    kebaruan: aspectField,
    timing: aspectField,
    shareability: aspectField,
  }),
  tags: z.array(z.string().max(40)).max(4),
  sensitive: z.boolean(),
  sensitiveReason: z.string().nullable(),
  blocked: z.boolean(),
  reason: z.string().max(280),
});

export type ScorePayload = z.infer<typeof scoreSchema>;

export function scoreTopic(text: string): {
  aspects: AspectScores;
  tags: string[];
  sensitive: boolean;
  sensitiveReason: string | null;
  blocked: boolean;
  reason: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("skor tidak valid");
  }
  const result = scoreSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("skor tidak valid");
  }
  return result.data;
}
