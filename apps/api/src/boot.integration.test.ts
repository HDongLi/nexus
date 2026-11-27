import type { DatabaseHandle } from "@nexus/db";
import { runMigrations } from "@nexus/db";
import { createEventLog } from "@nexus/event-log";
import { fail } from "@nexus/http-kit";
import { createSystemModule, createSystemRepo, systemContract } from "@nexus/system";
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { migrationsFolder } from "./database.ts";
import type { AccessVerifier } from "./http/access-guard.ts";
import {
  AUTH,
  boot,
  call,
  clearIdentity,
  createTestDatabase,
  loginAs,
  seedUser,
} from "./testing/kit.ts";

/**
 * 整条竖切：内存库 → 迁移 → 事件日志 → 模块 → 应用 → 真实的路由。
 * 不装数据库、不起进程，但走的是和启动时一模一样的代码。
 *
 * 两半。前一半只装系统模块、验证器由用例给：测的是应用层自己的机制（探活、503、访问闸听验证器的），
 * 和身份怎么接线无关，所以沿用骨架期的写法。后一半照启动时的接线整份装起来，验身份接上之后的入口。
 */
const log = pino({ level: "silent" });
const allowAll: AccessVerifier = async () => undefined;

let database: DatabaseHandle;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

/** 只装系统模块。 */
async function bootSystemOnly(options: { ping?: boolean; verify?: AccessVerifier } = {}) {
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

describe("应用层自己的机制", () => {
  it("健康探测回 200，数据库检查通过", async () => {
    const { app } = await bootSystemOnly();
    const res = await app.request("/api/v1/system/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string; checks: { db: string } };
    expect(body).toMatchObject({ status: "ok", version: "9.9.9", checks: { db: "ok" } });
  });

  it("数据库连不上：进程还活着，但如实回 503", async () => {
    const { app } = await bootSystemOnly({ ping: false });
    const res = await app.request("/api/v1/system/health");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { status: string }).status).toBe("degraded");
  });

  it("启动登记真的写进了事件表", async () => {
    const { eventLog } = await bootSystemOnly();
    const rows = await eventLog.list({ type: "system.started", limit: 1 });
    expect(rows[0]?.source).toBe("system");
    expect(rows[0]?.payload).toEqual({
      bootId: expect.any(String),
      version: "9.9.9",
      node: "vtest",
    });
  });

  it("访问闸听验证器的：验证器拒绝时，同一个接口回验证器给的响应，公开接口不受影响", async () => {
    const deny: AccessVerifier = async (c) => fail(c, 401, "unauthenticated", "请先登录");
    const { app } = await bootSystemOnly({ verify: deny });
    expect((await app.request("/api/v1/system/info")).status).toBe(401);
    expect((await app.request("/api/v1/system/health")).status).toBe(200);
  });

  it("迁移重放是幂等的", async () => {
    await runMigrations(database, migrationsFolder);
    const { app } = await bootSystemOnly();
    expect((await app.request("/api/v1/system/health")).status).toBe(200);
  });
});

describe("身份模块接上之后，照启动时的接线", () => {
  beforeEach(async () => {
    await clearIdentity(database.db);
  });

  it("版本信息不再回 501「身份模块还没有接入」：没登录 401 auth_required，登录后 200（I-05）", async () => {
    const api = await boot({ db: database.db });
    const anonymous = await call(api.app, AUTH.info);
    expect(anonymous.status).toBe(401);
    expect(anonymous.error?.code).toBe("auth_required");
    await seedUser(database.db, { username: "alice", password: "alice-password-1" });
    const { cookie } = await loginAs(api.app, "alice", "alice-password-1");
    const signed = await call(api.app, AUTH.info, { cookie });
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({
      version: "9.9.9",
      boot: { bootId: api.bootId, version: "9.9.9" },
    });
  });

  it("登录后能读到本次启动和之前的启动，新的在前", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: "alice-password-1" });
    const { cookie } = await loginAs(api.app, "alice", "alice-password-1");
    const body = (await call(api.app, AUTH.info, { cookie })).body as {
      boot: { version: string };
      recentBoots: { version: string }[];
    };
    expect(body.boot.version).toBe("9.9.9");
    expect(body.recentBoots.length).toBeGreaterThan(1);
    expect(body.recentBoots[0]?.version).toBe("9.9.9");
  });

  it("接上身份模块之后，健康探测还是公开的：谁都能调", async () => {
    const api = await boot({ db: database.db });
    expect((await call(api.app, AUTH.health)).status).toBe(200);
  });
});
