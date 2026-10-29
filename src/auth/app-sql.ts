import { PGlite } from "@electric-sql/pglite";
import { createPostgresSql, type Sql } from "../db/client";
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

function createLockedPostgresSql(
  query: (text: string, params: unknown[]) => Promise<unknown[]>,
): Sql {
  let locked: Promise<void> = Promise.resolve();

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = locked;
    let release!: () => void;
    locked = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(fn).finally(release);
  }

  const inner = createPostgresSql(query);
  return {
    rows(text, params) {
      return withLock(() => inner.rows(text, params));
    },
    tx(fn) {
      return withLock(() => inner.tx(fn));
    },
  };
}

function initPostgresSql(databaseUrl: string): Promise<Sql> {
  const state: { cached?: Promise<Sql> } = {};
  const drop = () => {
    if (state.cached && globalThis.__redaksiAppSql === state.cached) {
      globalThis.__redaksiAppSql = undefined;
    }
  };

  const attempt = (async () => {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl });
    // A dropped socket emits error, then end. No listener crashes the process,
    // and a cached client would keep serving queries on the dead connection.
    client.on("error", drop);
    client.on("end", drop);
    await client.connect();
    const sql = createLockedPostgresSql(async (text, params) => {
      const result = await client.query(text, params);
      return result.rows;
    });
    const { boot } = await import("../db/boot");
    await boot(sql);
    return sql;
  })();

  state.cached = attempt.catch((error: unknown) => {
    drop();
    throw error;
  });
  return state.cached;
}

/** Server SQL: Postgres when DATABASE_URL is set, otherwise one embedded PGlite. */
export async function getAppSql(): Promise<Sql> {
  if (!globalThis.__redaksiAppSql) {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl) {
      globalThis.__redaksiAppSql = initPostgresSql(databaseUrl);
    } else {
      const pending = initEmbeddedSql();
      globalThis.__redaksiAppSql = pending.catch((error: unknown) => {
        globalThis.__redaksiAppSql = undefined;
        throw error;
      });
    }
  }
  return globalThis.__redaksiAppSql;
}
