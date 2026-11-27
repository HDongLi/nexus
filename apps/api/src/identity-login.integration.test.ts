import type { DatabaseHandle } from "@nexus/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH,
  boot,
  call,
  clearIdentity,
  cookieHeader,
  cookieValue,
  createTestDatabase,
  DAY_MS,
  failureRows,
  identityEvents,
  loginAs,
  type Reply,
  seedUser,
  sessionRows,
} from "./testing/kit.ts";

/**
 * 登录这条竖切：内存库 → 真迁移 → 真路由 → 真 cookie → 真 argon2。断言库里的事实就直接查表。
 * 每个用例从清空的身份表开始：锁定的状态是存在库里的，不清就会留给下一个用例。
 */

let database: DatabaseHandle;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

// 一个文件共用一个库；每个用例动手之前清干净，断言「表里恰好有一行」才说得通。
beforeEach(async () => {
  await clearIdentity(database.db);
});

const PASSWORD = "alice-password-1";
/** 没带 X-Real-IP、又不是从真连接进来的请求（app.request 没有对端地址），事件里的来源地址记成这个。 */
const UNKNOWN_IP = "unknown";
const login = (app: Awaited<ReturnType<typeof boot>>["app"], username: string, password: string) =>
  call(app, AUTH.login, { method: "POST", body: { username, password } });

/** 去掉请求号之后的回应：状态码、错误码、给人看的那句话。 */
function shape(reply: Reply): unknown {
  return {
    status: reply.status,
    error: {
      code: reply.error?.code,
      message: reply.error?.message,
      details: reply.error?.details,
    },
  };
}

describe("登录", () => {
  it("成功：200，正文直接带回这个人；令牌只在 HttpOnly cookie 里，库里存的是它的散列；发一条成功事件（I-18、I-26、I-39）", async () => {
    const { app } = await boot({ db: database.db });
    const user = await seedUser(database.db, { username: "alice", password: PASSWORD });
    const reply = await call(app, AUTH.login, {
      method: "POST",
      body: { username: "alice", password: PASSWORD },
      headers: { "x-real-ip": "203.0.113.9" },
      requestId: "trace-login-1",
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      user: { id: user.id, username: "alice", displayName: "alice", isAdmin: false },
    });
    expect(Object.keys(reply.body as object)).toEqual(["user"]);

    const token = cookieValue(reply.setCookies[0] ?? "");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await sessionRows(database.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);
    // 正文里也不出现令牌（I-21）
    expect(JSON.stringify(reply.body)).not.toContain(token);

    const events = await identityEvents(database.db, "identity.login.succeeded");
    expect(events).toHaveLength(1);
    // userId 是当事人那一个账号的编号（规格事件表）
    expect(events[0]).toMatchObject({
      source: "identity",
      subject: "alice",
      payload: { userId: user.id, ip: "203.0.113.9" },
      trace_id: reply.requestId,
    });
    expect(reply.requestId).toBe("trace-login-1");
  });

  it("用户名不存在、账号没有口令、口令不对：三种回应去掉请求号后逐字相同（I-10）", async () => {
    const { app } = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    await seedUser(database.db, { username: "nopass", passwordHash: null });
    const replies = [
      await login(app, "ghost", "whatever-1"),
      await login(app, "nopass", "whatever-1"),
      await login(app, "alice", "whatever-1"),
    ];
    for (const reply of replies) {
      expect(reply.status).toBe(401);
      expect(reply.error?.code).toBe("auth_invalid_credentials");
    }
    expect(shape(replies[1] as Reply)).toEqual(shape(replies[0] as Reply));
    expect(shape(replies[2] as Reply)).toEqual(shape(replies[0] as Reply));
    // 三次都留了痕，subject 是各自提交的用户名
    expect(
      (await identityEvents(database.db, "identity.login.failed")).map((e) => e.subject),
    ).toEqual(["ghost", "nopass", "alice"]);
  });

  it("停用账号：口令错是 401「不对」，口令对才是 403「已停用」，并且不发成功事件（I-09、I-28）", async () => {
    const { app } = await boot({ db: database.db });
    await seedUser(database.db, {
      username: "officer",
      password: PASSWORD,
      disabledAt: new Date("2026-11-20T00:00:00.000Z"),
    });
    const wrong = await login(app, "officer", "not-the-password");
    const right = await login(app, "officer", PASSWORD);
    expect(wrong.status).toBe(401);
    expect(wrong.error?.code).toBe("auth_invalid_credentials");
    expect(right.status).toBe(403);
    expect(right.error?.code).toBe("auth_account_disabled");
    expect(right.setCookies).toEqual([]);
    expect(await identityEvents(database.db, "identity.login.succeeded")).toHaveLength(0);
    expect((await identityEvents(database.db, "identity.login.failed")).at(-1)?.payload).toEqual({
      ip: UNKNOWN_IP,
      reason: "account_disabled",
    });
  });

  it("存的不是 argon2id 格式（旧系统的 64 位十六进制串）：按口令不对处理，不报错（I-08）", async () => {
    const { app } = await boot({ db: database.db });
    await seedUser(database.db, { username: "legacy", passwordHash: "0123456789abcdef".repeat(4) });
    const reply = await login(app, "legacy", "any-password");
    expect(reply.status).toBe(401);
    expect(reply.error?.code).toBe("auth_invalid_credentials");
  });

  it("请求体不合形状：400 invalid_request，不验口令、不计失败、不发事件（I-02）", async () => {
    const { app } = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const failuresBefore = (await failureRows(database.db)).length;
    const eventsBefore = (await identityEvents(database.db)).length;
    const bad = [
      { username: "", password: "x" },
      { username: "a".repeat(65), password: "x" },
      { username: "alice", password: "x".repeat(129) },
      { username: "alice" },
      { username: "alice", password: 123 },
    ];
    for (const body of bad) {
      const reply = await call(app, AUTH.login, { method: "POST", body });
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(reply.error?.code, JSON.stringify(body)).toBe("invalid_request");
    }
    expect(await failureRows(database.db)).toHaveLength(failuresBefore);
    expect(await identityEvents(database.db)).toHaveLength(eventsBefore);
  });

  it("旧的 /api/auth/* 路径不保留，四个都回 404 not_found（I-03）", async () => {
    const { app } = await boot({ db: database.db });
    for (const [path, method] of [
      ["/api/auth/login", "POST"],
      ["/api/auth/logout", "POST"],
      ["/api/auth/whoami", "GET"],
      ["/api/auth/passwd", "POST"],
    ] as const) {
      const reply = await call(app, path, { method, ...(method === "POST" ? { body: {} } : {}) });
      expect(reply.status, path).toBe(404);
      expect(reply.error?.code, path).toBe("not_found");
    }
  });
});

describe("登录锁定", () => {
  it("连错 5 次都是 401，第 6 次 429：还要等的秒数在 1 到 900 之间（I-13、I-14）", async () => {
    const { app } = await boot({ db: database.db });
    await seedUser(database.db, { username: "locky", password: PASSWORD });
    for (let i = 1; i <= 5; i++) {
      const reply = await login(app, "locky", "wrong-password");
      expect(reply.status, `第 ${i} 次`).toBe(401);
      expect(reply.error?.code).toBe("auth_invalid_credentials");
    }
    const sixth = await login(app, "locky", PASSWORD);
    expect(sixth.status).toBe(429);
    expect(sixth.error?.code).toBe("auth_locked_out");
    const seconds = sixth.error?.details?.retryAfterSeconds;
    expect(typeof seconds).toBe("number");
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(900);
  });

  it("锁定期间口令正确也 429，失败记录不再变；满 900 秒后恢复（I-14）", async () => {
    const { app, clock } = await boot({ db: database.db });
    await seedUser(database.db, { username: "holden", password: PASSWORD });
    for (let i = 0; i < 5; i++) await login(app, "holden", "wrong-password");
    const before = await failureRows(database.db);
    const holden = before.find((row) => row.username === "holden");
    expect(holden).toMatchObject({ failure_count: 5 });
    expect(holden?.locked_until).not.toBeNull();

    const right = await login(app, "holden", PASSWORD);
    expect(right.status).toBe(429);
    expect(right.setCookies).toEqual([]);
    expect((await login(app, "holden", "wrong-password")).status).toBe(429);
    expect(await failureRows(database.db)).toEqual(before);
    expect(await identityEvents(database.db, "identity.login.failed")).toContainEqual(
      expect.objectContaining({
        subject: "holden",
        payload: { ip: UNKNOWN_IP, reason: "locked_out" },
      }),
    );

    // 差一秒还不行，满 900 秒就可以了
    clock.tick(900_000 - 1_000);
    expect((await login(app, "holden", PASSWORD)).status).toBe(429);
    clock.tick(1_000);
    const back = await login(app, "holden", PASSWORD);
    expect(back.status).toBe(200);
    // 登录成功清掉了失败记录（I-16）
    expect(
      (await failureRows(database.db)).find((row) => row.username === "holden"),
    ).toBeUndefined();
  });

  it("从第 5 次失败那一刻算起；满 900 秒后再错，回 401，按新的窗口重新计数（I-13）", async () => {
    const { app, clock } = await boot({ db: database.db });
    await seedUser(database.db, { username: "window", password: PASSWORD });
    for (let i = 0; i < 4; i++) await login(app, "window", "wrong-password");
    clock.tick(600_000);
    await login(app, "window", "wrong-password");
    const lockedAt = clock.now();
    expect(
      (await failureRows(database.db))
        .find((row) => row.username === "window")
        ?.locked_until?.getTime(),
    ).toBe(lockedAt.getTime() + 900_000);
    clock.tick(900_000);
    const again = await login(app, "window", "wrong-password");
    expect(again.status).toBe(401);
    expect(await failureRows(database.db)).toContainEqual(
      expect.objectContaining({ username: "window", failure_count: 1, locked_until: null }),
    );
  });

  it("登录成功清计数：错 4 次后登录成功，再错 4 次都不锁（I-16）", async () => {
    const { app } = await boot({ db: database.db });
    await seedUser(database.db, { username: "clear", password: PASSWORD });
    for (let i = 0; i < 4; i++) await login(app, "clear", "wrong-password");
    expect((await login(app, "clear", PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++)
      expect((await login(app, "clear", "wrong-password")).status).toBe(401);
    expect((await login(app, "clear", PASSWORD)).status).toBe(200);
  });

  it("换大小写算同一个用户名；用户名不存在也同样记、同样锁（I-12）", async () => {
    const { app } = await boot({ db: database.db });
    await seedUser(database.db, { username: "Casey", password: PASSWORD });
    for (const name of ["Casey", "CASEY", "casey"]) await login(app, name, "wrong-password");
    await login(app, "cAsEy", "wrong-password");
    expect((await login(app, "casey", "wrong-password")).status).toBe(401);
    expect((await login(app, "CASEY", PASSWORD)).status).toBe(429);
    expect(await failureRows(database.db)).toContainEqual(
      expect.objectContaining({ username: "casey", failure_count: 5 }),
    );

    for (let i = 0; i < 5; i++) await login(app, "Nobody", "wrong-password");
    expect((await login(app, "nobody", PASSWORD)).status).toBe(429);
  });

  it("锁定存在库里：错 4 次，重建模块和应用，再错 1 次、第 6 次 429（I-15）", async () => {
    const first = await boot({ db: database.db });
    await seedUser(database.db, { username: "persist", password: PASSWORD });
    for (let i = 0; i < 4; i++) await login(first.app, "persist", "wrong-password");
    const second = await boot({ db: database.db });
    expect((await login(second.app, "persist", "wrong-password")).status).toBe(401);
    expect((await login(second.app, "persist", PASSWORD)).status).toBe(429);
  });

  it("锁住一个用户名，另一个账号照常登录；健康探测一直 200，不管有没有登录、有没有被锁、账号停没停（I-17、I-43）", async () => {
    const { app } = await boot({ db: database.db });
    await seedUser(database.db, { username: "lockedone", password: PASSWORD });
    await seedUser(database.db, { username: "bobby", password: PASSWORD });
    await seedUser(database.db, {
      username: "goneoff",
      password: PASSWORD,
      disabledAt: new Date(),
    });
    for (let i = 0; i < 5; i++) await login(app, "lockedone", "wrong-password");
    const bobby = await loginAs(app, "bobby", PASSWORD);
    expect(bobby.status).toBe(200);
    // 没登录的、登录了的、带着假会话的，健康探测都是 200
    expect((await call(app, AUTH.health)).status).toBe(200);
    expect((await call(app, AUTH.health, { cookie: bobby.cookie })).status).toBe(200);
    expect((await call(app, AUTH.health, { cookie: "nexus_session=forged" })).status).toBe(200);
    const officer = await loginAs(app, "goneoff", PASSWORD);
    expect(officer.status).toBe(403);
  });
});

describe("会话无效", () => {
  it("伪造的令牌得 401；过了有效期的会话不再认；过期行在下一次登录时删掉（I-23）", async () => {
    const { app, clock } = await boot({ db: database.db });
    await seedUser(database.db, { username: "sunny", password: PASSWORD });
    expect((await call(app, AUTH.me, { cookie: "nexus_session=forged-token" })).status).toBe(401);

    const first = await login(app, "sunny", PASSWORD);
    const cookie = cookieHeader(first.setCookies[0] ?? "");
    expect((await call(app, AUTH.me, { cookie })).status).toBe(200);
    clock.tick(30 * DAY_MS);
    const expired = await call(app, AUTH.me, { cookie });
    expect(expired.status).toBe(401);
    expect(expired.error?.code).toBe("auth_required");

    const second = await login(app, "sunny", PASSWORD);
    expect(second.status).toBe(200);
    const rows = await sessionRows(database.db);
    expect(rows).toHaveLength(1);
    expect(cookieValue(second.setCookies[0] ?? "")).not.toBe(
      cookieValue(first.setCookies[0] ?? ""),
    );
  });

  it("这一片不认 Authorization 头：带着令牌却不带 cookie，照样 401（I-21）", async () => {
    const { app } = await boot({ db: database.db });
    await seedUser(database.db, { username: "bearer", password: PASSWORD });
    const { cookie } = await loginAs(app, "bearer", PASSWORD);
    const token = cookie.split("=")[1] ?? "";
    const reply = await call(app, AUTH.me, { headers: { authorization: `Bearer ${token}` } });
    expect(reply.status).toBe(401);
    expect(reply.error?.code).toBe("auth_required");
  });
});
