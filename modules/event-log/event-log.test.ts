import type { Tx } from "@nexus/db";
import { describe, expect, it } from "vitest";
import { createEventLog, InvalidEventError, type EventRepo, type EventRow } from "./index.ts";

const row: EventRow = {
  id: 7,
  type: "system.started",
  source: "system",
  subject: null,
  payload: { bootId: "b-1" },
  occurredAt: new Date("2026-11-26T00:00:00.000Z"),
  traceId: null,
};

interface Call {
  kind: "insert" | "list";
  ex: unknown;
  detail: unknown;
}

function fakeDb(): { db: object; repo: EventRepo; calls: Call[] } {
  const db = { fake: "db" };
  const calls: Call[] = [];
  const repo: EventRepo = {
    insert: async (ex, input) => {
      calls.push({ kind: "insert", ex, detail: input });
      return {
        id: row.id,
        type: input.type,
        source: input.source,
        subject: input.subject ?? null,
        payload: input.payload,
        occurredAt: input.occurredAt,
        traceId: input.traceId ?? null,
      };
    },
    list: async (ex, query) => {
      calls.push({ kind: "list", ex, detail: query });
      return [row];
    },
  };
  return { db, repo, calls };
}

describe("事件日志的用例", () => {
  it("拒绝不合信封的事件，并且不碰仓储", async () => {
    const { db, repo, calls } = fakeDb();
    const log = createEventLog({ db: db as never, repo });
    await expect(
      log.emit({ type: "Bad Name", source: "system", payload: {} }),
    ).rejects.toBeInstanceOf(InvalidEventError);
    expect(calls).toEqual([]);
  });

  it("事件名不是「模块.动作」也不收", async () => {
    const { db, repo } = fakeDb();
    const log = createEventLog({ db: db as never, repo });
    await expect(log.emit({ type: "started", source: "system", payload: {} })).rejects.toThrow(
      InvalidEventError,
    );
    await expect(
      log.emit({ type: "system.started", source: "System", payload: {} }),
    ).rejects.toThrow(InvalidEventError);
  });

  it("发出时补上发生时间，交仓储写入，返回的记录不带 null", async () => {
    const { db, repo, calls } = fakeDb();
    const log = createEventLog({ db: db as never, repo });
    const before = Date.now();
    const record = await log.emit({ type: "system.started", source: "system", payload: { a: 1 } });
    const inserted = calls[0];
    expect(inserted?.kind).toBe("insert");
    if (inserted?.kind !== "insert") throw new Error("应当是一次写入");
    const written = inserted.detail as EventRow;
    expect(written.type).toBe("system.started");
    expect(written.subject).toBeNull();
    expect(written.traceId).toBeNull();
    expect(Math.abs(written.occurredAt.getTime() - before)).toBeLessThan(2000);
    expect(record).toEqual({
      id: 7,
      type: "system.started",
      source: "system",
      payload: { a: 1 },
      occurredAt: written.occurredAt.toISOString(),
    });
  });

  it("调用方给了事务，就原样交给仓储（事件和业务写入同一个事务）", async () => {
    const { db, repo, calls } = fakeDb();
    const log = createEventLog({ db: db as never, repo });
    const tx = { fake: "tx" } as unknown as Tx;
    await log.emit({ type: "system.started", source: "system", payload: {} }, tx);
    expect(calls[0]?.ex).toBe(tx);
  });

  it("列表默认取 50 条，最多 200 条", async () => {
    const { db, repo, calls } = fakeDb();
    const log = createEventLog({ db: db as never, repo });
    await log.list({});
    await log.list({ limit: 5000 });
    await log.list({ limit: 0, type: "system.started", after: 3 });
    const limits = calls.map((call) => (call.detail as { limit: number }).limit);
    expect(limits).toEqual([50, 200, 1]);
    expect(calls[2]?.detail).toEqual({
      type: "system.started",
      subject: undefined,
      after: 3,
      limit: 1,
    });
  });
});
