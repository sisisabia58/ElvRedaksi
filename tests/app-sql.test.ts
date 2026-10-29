import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppSql } from "../src/auth/app-sql";

type FakeClient = EventEmitter & {
  connectionString?: string;
  connect: () => Promise<void>;
};

const clients: FakeClient[] = [];
let failConnects = 0;

vi.mock("pg", () => ({
  Client: class extends EventEmitter {
    connectionString?: string;
    constructor(config?: { connectionString?: string }) {
      super();
      this.connectionString = config?.connectionString;
      clients.push(this as FakeClient);
    }
    connect() {
      if (failConnects > 0) {
        failConnects -= 1;
        return Promise.reject(new Error("connect failed"));
      }
      return Promise.resolve();
    }
    query() {
      return Promise.resolve({ rows: [] });
    }
  },
}));

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousSeedDemo = process.env.SEED_DEMO;

afterEach(() => {
  clients.length = 0;
  failConnects = 0;
  globalThis.__redaksiAppSql = undefined;
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
  if (previousSeedDemo === undefined) {
    delete process.env.SEED_DEMO;
  } else {
    process.env.SEED_DEMO = previousSeedDemo;
  }
});

describe("getAppSql postgres client", () => {
  it("opens a new client after the cached one emits error or end", async () => {
    delete process.env.SEED_DEMO;
    process.env.DATABASE_URL = "postgres://redaksi:redaksi@127.0.0.1:5432/redaksi";

    const first = await getAppSql();
    expect(clients).toHaveLength(1);
    expect(clients[0].listenerCount("error")).toBeGreaterThan(0);
    expect(clients[0].listenerCount("end")).toBeGreaterThan(0);

    expect(() => clients[0].emit("error", new Error("connection terminated unexpectedly"))).not.toThrow();
    expect(globalThis.__redaksiAppSql).toBeUndefined();

    const second = await getAppSql();
    expect(second).not.toBe(first);
    expect(clients).toHaveLength(2);

    clients[0].emit("end");
    expect(globalThis.__redaksiAppSql).toBeDefined();
    const stillSecond = await getAppSql();
    expect(stillSecond).toBe(second);
    expect(clients).toHaveLength(2);

    clients[1].emit("end");
    expect(globalThis.__redaksiAppSql).toBeUndefined();
    const third = await getAppSql();
    expect(third).not.toBe(second);
    expect(clients).toHaveLength(3);
  });

  it("clears the cache when the first connect rejects and connects again", async () => {
    delete process.env.SEED_DEMO;
    process.env.DATABASE_URL = "postgres://redaksi:redaksi@127.0.0.1:5432/redaksi";
    failConnects = 1;

    await expect(getAppSql()).rejects.toThrow("connect failed");
    expect(globalThis.__redaksiAppSql).toBeUndefined();

    const sql = await getAppSql();
    expect(sql).toBeTruthy();
    expect(clients).toHaveLength(2);
  });
});
