import type { DatabaseHandle } from "@nexus/db";
import { createIdentityRepo, type IdentityRepo } from "@nexus/identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH,
  boot,
  call,
  clearIdentity,
  createTestDatabase,
  failureRows,
  identityEvents,
  seedUser,
  sessionRows,
  userRows,
} from "./testing/kit.ts";

let database: DatabaseHandle;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await clearIdentity(database.db);
});

const PASSWORD = "alice-password-1";
const NEXT = "brand-new-password";

/** 把五个事件各发一遍：建号（脚本走的用例）、登录失败、登录成功、改密、退出。回 cookie 值和事件。 */
async function playAll() {
  const api = await boot({ db: database.db });
  const created = await api.identity.service.createUser({
    username: "alice",
    password: PASSWORD,
    isAdmin: false,
  });
  if (created.kind !== "ok") throw new Error("建号应当成功");
  await call(api.app, AUTH.login, {
    method: "POST",
    body: { username: "alice", password: "wrong-password" },
    requestId: "r-failed",
  });
  const ok = await call(api.app, AUTH.login, {
    method: "POST",
    body: { username: "alice", password: PASSWORD },
    requestId: "r-login",
  });
  const cookie = ok.setCookies[0]?.split(";")[0] ?? "";
  const changed = await call(api.app, AUTH.password, {
    method: "POST",
    cookie,
    body: { currentPassword: PASSWORD, newPassword: NEXT },
    requestId: "r-change",
  });
  const fresh = changed.setCookies[0]?.split(";")[0] ?? "";
  await call(api.app, AUTH.logout, { method: "POST", cookie: fresh, requestId: "r-logout" });
  return { api, created, tokens: [cookie, fresh].map((pair) => pair.split("=")[1] ?? "") };
}

describe("审计事件（规格 I-39 到 I-41）", () => {
  it("五个事件各自的时机、source、subject、payload 的键；traceId 等于响应头里的请求号（I-39）", async () => {
    const { created } = await playAll();
    const events = await identityEvents(database.db);
    expect(
      events.map((e) => [e.type, e.source, e.subject, Object.keys(e.payload).sort(), e.trace_id]),
    ).toEqual([
      ["identity.user.created", "identity", "alice", ["isAdmin", "userId", "via"], null],
      // 登录失败不带 userId：失败时未必有这个人
      ["identity.login.failed", "identity", "alice", ["ip", "reason"], "r-failed"],
      ["identity.login.succeeded", "identity", "alice", ["ip", "userId"], "r-login"],
      [
        "identity.password.changed",
        "identity",
        "alice",
        ["ip", "revokedSessions", "userId"],
        "r-change",
      ],
      ["identity.logout", "identity", "alice", ["ip", "userId"], "r-logout"],
    ]);
    expect(events[0]?.payload).toEqual({ userId: created.user.id, isAdmin: false, via: "cli" });
    expect(events[1]?.payload).toEqual({ ip: "unknown", reason: "invalid_credentials" });
    // 由人触发的三个写事件，userId 都是当事人那一个账号的编号
    expect(events[2]?.payload).toEqual({ userId: created.user.id, ip: "unknown" });
    expect(events[3]?.payload).toEqual({
      userId: created.user.id,
      ip: "unknown",
      revokedSessions: 0,
    });
    expect(events[4]?.payload).toEqual({ userId: created.user.id, ip: "unknown" });
    for (const event of events.slice(1))
      expect(event.occurred_at).toEqual(new Date("2026-11-27T00:00:00.000Z"));
  });

  it("事件内容里没有口令、散列、盐、令牌：每个事件序列化后都不含（I-40）", async () => {
    const { tokens } = await playAll();
    const hash = (await userRows(database.db))[0]?.password_hash as string;
    const serialized = JSON.stringify(await identityEvents(database.db));
    for (const secret of [
      PASSWORD,
      "wrong-password",
      NEXT,
      hash,
      ...hash.split("$").slice(2),
      ...tokens,
    ]) {
      expect(secret.length, secret).toBeGreaterThan(0);
      expect(serialized.includes(secret), secret.slice(0, 12)).toBe(false);
    }
  });

  it("登录与改密期间的日志行不含口令，也不含散列；请求本身照常留痕（I-40）", async () => {
    const { api } = await playAll();
    const hash = (await userRows(database.db))[0]?.password_hash as string;
    const logs = JSON.stringify(api.log.entries());
    for (const secret of [PASSWORD, "wrong-password", NEXT, hash]) {
      expect(logs.includes(secret), secret.slice(0, 12)).toBe(false);
    }
    const requests = api.log.entries().filter((entry) => entry.msg === "request");
    expect(requests.map((entry) => entry.path)).toEqual([
      AUTH.login,
      AUTH.login,
      AUTH.password,
      AUTH.logout,
    ]);
  });

  it("事件和写入同一个事务：写入之后抛错，回滚后事件表没有新行，业务表里也没有（I-41）", async () => {
    const real = createIdentityRepo();

    // 登录成功：会话行写进去了再抛
    const loginBoom = await boot({ db: database.db, repo: explodeAfter(real, "sessions.insert") });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const ok = await call(loginBoom.app, AUTH.login, {
      method: "POST",
      body: { username: "alice", password: PASSWORD },
    });
    expect(ok.status).toBe(500);
    expect(ok.error?.code).toBe("internal_error");
    expect(await sessionRows(database.db)).toEqual([]);
    expect(await identityEvents(database.db, "identity.login.succeeded")).toEqual([]);
    expect(loginBoom.log.entries().some((entry) => entry.msg === "请求处理失败")).toBe(true);

    // 登录失败：失败记录写进去了再抛，那条失败事件也不许落库
    const failBoom = await boot({ db: database.db, repo: explodeAfter(real, "failures.put") });
    const wrong = await call(failBoom.app, AUTH.login, {
      method: "POST",
      body: { username: "alice", password: "wrong-password" },
    });
    expect(wrong.status).toBe(500);
    expect(await failureRows(database.db)).toEqual([]);
    expect(await identityEvents(database.db, "identity.login.failed")).toEqual([]);

    // 建号：账号行写进去了再抛
    const createBoom = await boot({ db: database.db, repo: explodeAfter(real, "users.insert") });
    await expect(
      createBoom.identity.service.createUser({
        username: "newbie",
        password: PASSWORD,
        isAdmin: false,
      }),
    ).rejects.toThrow("写入之后");
    // 之前种的那一行还在，新建的没有多出来
    expect(await userRows(database.db)).toHaveLength(1);
    expect(await identityEvents(database.db, "identity.user.created")).toEqual([]);

    // 对照：同一份库换回真仓储，同样的操作都成
    const sane = await boot({ db: database.db, repo: real });
    expect(
      (
        await call(sane.app, AUTH.login, {
          method: "POST",
          body: { username: "alice", password: PASSWORD },
        })
      ).status,
    ).toBe(200);
    expect(await identityEvents(database.db, "identity.login.succeeded")).toHaveLength(1);
  });
});

/** 真仓储外面套一层：指定的那个方法照常写，写完就抛。 */
function explodeAfter(
  real: IdentityRepo,
  target: "sessions.insert" | "failures.put" | "users.insert",
): IdentityRepo {
  const afterWrite =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await fn(...args);
      throw new Error("写入之后磁盘满了");
    };
  if (target === "sessions.insert")
    return { ...real, sessions: { ...real.sessions, insert: afterWrite(real.sessions.insert) } };
  if (target === "failures.put")
    return { ...real, failures: { ...real.failures, put: afterWrite(real.failures.put) } };
  return { ...real, users: { ...real.users, insert: afterWrite(real.users.insert) } };
}
