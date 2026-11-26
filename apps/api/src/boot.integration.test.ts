import { createDatabase, runMigrations, type DatabaseHandle } from "@nexus/db";
import { createEventLog } from "@nexus/event-log";
import { createSystemModule, createSystemRepo, systemContract } from "@nexus/system";
import { fail } from "@nexus/http-kit";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { AccessVerifier } from "./http/access-guard.ts";

/**
 * 整条竖切：内存库 → 迁移 → 事件日志 → 系统模块 → 应用 → 真实的路由。
 * 不装数据库、不起进程，但走的是和启动时一模一样的代码。
 */
const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
const log = pino({ level: "silent" });
const allowAll: AccessVerifier = async () => undefined;

let database: DatabaseHandle;

async function boot(options: { ping?: boolean; verify?: AccessVerifier } = {}) {
  const eventLog = createEventLog({ db: database.db });
  const system = createSystemModule({
    repo: options.ping === false ? { ping: async () => false } : createSystemRepo(database.db),
    eventLog,
    version: "9.9.9",
    runtime: "vtest",
  });
  await system.service.recordStart(randomUUID());
  const { app } = createApp({
    log,
    modules: [{ name: systemContract.name, bindings: system.bindings }],
    verify: options.verify ?? allowAll,
  });
  return { app, eventLog, system };
}

beforeAll(async () => {
  database = await createDatabase({});
  await runMigrations(database, migrationsFolder);
});

afterAll(async () => {
  await database.close();
});

describe("从空库启动的整条竖切", () => {
  it("健康探测回 200，数据库检查通过", async () => {
    const { app } = await boot();
    const res = await app.request("/api/v1/system/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string; checks: { db: string } };
    expect(body).toMatchObject({ status: "ok", version: "9.9.9", checks: { db: "ok" } });
  });

  it("数据库连不上：进程还活着，但如实回 503", async () => {
    const { app } = await boot({ ping: false });
    const res = await app.request("/api/v1/system/health");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { status: string }).status).toBe("degraded");
  });

  it("启动登记真的写进了事件表", async () => {
    const { eventLog } = await boot();
    const rows = await eventLog.list({ type: "system.started", limit: 1 });
    expect(rows[0]?.source).toBe("system");
    expect(rows[0]?.payload).toEqual({
      bootId: expect.any(String),
      version: "9.9.9",
      node: "vtest",
    });
  });

  it("放行时能读到本次启动和之前的启动，新的在前", async () => {
    const { app } = await boot();
    const res = await app.request("/api/v1/system/info");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      boot: { version: string };
      recentBoots: { version: string }[];
    };
    expect(body.boot.version).toBe("9.9.9");
    expect(body.recentBoots.length).toBeGreaterThan(1);
    expect(body.recentBoots[0]?.version).toBe("9.9.9");
  });

  it("验证器拒绝时，同一个接口回验证器给的响应", async () => {
    const deny: AccessVerifier = async (c) => fail(c, 401, "unauthenticated", "请先登录");
    const { app } = await boot({ verify: deny });
    expect((await app.request("/api/v1/system/info")).status).toBe(401);
    // 公开接口不受影响
    expect((await app.request("/api/v1/system/health")).status).toBe(200);
  });

  it("迁移重放是幂等的", async () => {
    await runMigrations(database, migrationsFolder);
    const { app } = await boot();
    expect((await app.request("/api/v1/system/health")).status).toBe(200);
  });
});
