import type { Sql } from "../db/client";
import { TIME_ZONE } from "../domain/constants";

export async function spendSummary(sql: Sql, now: Date): Promise<{ today: number; month: number }> {
  const rows = await sql.rows<{ today: string; month: string }>(
    `select
       coalesce(sum(case
         when (created_at at time zone '${TIME_ZONE}')::date = ($1 at time zone '${TIME_ZONE}')::date
         then cost_usd else 0 end), 0) as today,
       coalesce(sum(case
         when date_trunc('month', created_at at time zone '${TIME_ZONE}')
           = date_trunc('month', $1 at time zone '${TIME_ZONE}')
         then cost_usd else 0 end), 0) as month
     from llm_spend`,
    [now],
  );
  const row = rows[0];
  return { today: Number(row?.today ?? 0), month: Number(row?.month ?? 0) };
}
