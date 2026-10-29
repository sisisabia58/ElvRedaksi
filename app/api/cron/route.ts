import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppSql } from "@/src/auth/app-sql";
import { boot } from "@/src/db/boot";
import { jobHandlers } from "@/src/jobs/handlers";
import { runDueJobs } from "@/src/jobs/runner";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("Authorization") ?? "");
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

async function loadWorkHours(sql: Awaited<ReturnType<typeof getAppSql>>) {
  const rows = await sql.rows<{ work_start: string; work_end: string }>(
    "select work_start, work_end from brand where id = 1",
  );
  if (!rows[0]) {
    return { workStart: "07:00", workEnd: "22:00" };
  }
  return { workStart: rows[0].work_start, workEnd: rows[0].work_end };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sql = await getAppSql();
  await boot(sql);
  const { workStart, workEnd } = await loadWorkHours(sql);
  const ran = await runDueJobs(sql, new Date(), {
    handlers: jobHandlers,
    workStart,
    workEnd,
  });

  return NextResponse.json({ ran });
}

export async function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}
