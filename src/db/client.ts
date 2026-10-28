import { PGlite } from "@electric-sql/pglite";
import { DDL } from "./sql";

export type Sql = {
  rows<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
};

function fromPglite(pg: PGlite): Sql {
  const sql: Sql = {
    async rows<T>(text: string, params: unknown[] = []) {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
    async tx<T>(fn: (inner: Sql) => Promise<T>) {
      await pg.query("begin");
      try {
        const value = await fn(sql);
        await pg.query("commit");
        return value;
      } catch (error) {
        await pg.query("rollback");
        throw error;
      }
    },
  };
  return sql;
}

export async function createTestSql(): Promise<Sql> {
  const pg = new PGlite();
  const sql = fromPglite(pg);
  for (const statement of DDL.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await pg.query(statement.endsWith(";") ? statement : `${statement};`);
  }
  return sql;
}

export function createPostgresSql(query: (text: string, params: unknown[]) => Promise<unknown[]>): Sql {
  const sql: Sql = {
    async rows<T>(text: string, params: unknown[] = []) {
      return (await query(text, params)) as T[];
    },
    async tx(fn) {
      await query("begin", []);
      try {
        const value = await fn(sql);
        await query("commit", []);
        return value;
      } catch (error) {
        await query("rollback", []);
        throw error;
      }
    },
  };
  return sql;
}
