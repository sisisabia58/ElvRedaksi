import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db/client";
import { DDL } from "../db/sql";

declare global {
  var __redaksiAppSql: Promise<Sql> | undefined;
}

function fromPglite(pg: PGlite): Sql {
  return {
    async rows<T>(text: string, params: unknown[] = []) {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
    async tx<T>(fn: (inner: Sql) => Promise<T>) {
      await pg.query("begin");
      try {
        const inner = fromPglite(pg);
        const value = await fn(inner);
        await pg.query("commit");
        return value;
      } catch (error) {
        await pg.query("rollback");
        throw error;
      }
    },
  };
}

async function initEmbeddedSql(): Promise<Sql> {
  const pg = new PGlite();
  for (const statement of DDL.split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    await pg.query(statement.endsWith(";") ? statement : `${statement};`);
  }
  return fromPglite(pg);
}

/** Server-side SQL for the studio app (embedded PGlite until production wiring lands). */
export async function getAppSql(): Promise<Sql> {
  if (!globalThis.__redaksiAppSql) {
    globalThis.__redaksiAppSql = initEmbeddedSql();
  }
  return globalThis.__redaksiAppSql;
}
