import type { JobCtx } from "./runner";

export async function runScout(_ctx: JobCtx): Promise<void> {}

export async function runAnalyst(_ctx: JobCtx): Promise<void> {}

export async function runCopywriter(_ctx: JobCtx): Promise<void> {}

export async function runDesigner(_ctx: JobCtx): Promise<void> {}

export async function runPublisher(_ctx: JobCtx): Promise<void> {}

export async function runInsights(_ctx: JobCtx): Promise<void> {}

export const jobHandlers = {
  "scout.scan": runScout,
  "analyst.score": runAnalyst,
  "copywriter.write": runCopywriter,
  "designer.render": runDesigner,
  "publisher.publish": runPublisher,
  "insights.sync": runInsights,
};
