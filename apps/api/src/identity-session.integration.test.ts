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
  identityEvents,
  loginAs,
  seedUser,
  sessionRows,
  T0,
  type TestApp,
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
const EXPIRES = T0.getTime() + 30 * DAY_MS;
const COOKIE_ATTRIBUTES = ["Max-Age=2592000", "Path=/", "HttpOnly", "SameSite=Lax"];

/** 把 Set-Cookie 拆成「名字=值」和一组属性。 */
function parseSetCookie(header: string): { pair: string; attributes: string[] } {
  const [pair = "", ...rest] = header.split(";");
  return { pair: pair.trim(), attributes: rest.map((part) => part.trim()) };
}

/** 一个装好的应用，加上一个已经登录的管理员 alice。api 是整个应用，api.app 是打请求用的那一个。 */
async function signedIn(): Promise<TestApp & { userId: string; cookie: string }> {
  const api = await boot({ db: database.db });
  const user = await seedUser(database.db, {
    username: "alice",
    password: PASSWORD,
    isAdmin: true,
  });
  const reply = await loginAs(api.app, "alice", PASSWORD);
  return { ...api, userId: user.id, cookie: reply.cookie };
}

describe("我是谁", () => {
  it("已登录的人调我是谁：200，user 恰好是四个键（I-26）", async () => {
    const api = await signedIn();
    const reply = await call(api.app, AUTH.me, { cookie: api.cookie });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      user: { id: api.userId, username: "alice", displayName: "alice", isAdmin: true },
    });
    expect(Object.keys(reply.body as object)).toEqual(["user"]);
    expect(Object.keys((reply.body as { user: object }).user).sort()).toEqual([
      "displayName",
      "id",
      "isAdmin",
      "username",
    ]);
  });

  it("isAdmin 回的就是账号上的那个布尔位（I-27）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "plain", password: PASSWORD });
    await seedUser(database.db, { username: "chief", password: PASSWORD, isAdmin: true });
    const plain = await loginAs(api.app, "plain", PASSWORD);
    const chief = await loginAs(api.app, "chief", PASSWORD);
    expect((await call(api.app, AUTH.me, { cookie: plain.cookie })).body).toMatchObject({
      user: { username: "plain", isAdmin: false },
    });
    expect((await call(api.app, AUTH.me, { cookie: chief.cookie })).body).toMatchObject({
      user: { username: "chief", isAdmin: true },
    });
  });
});

describe("会话 cookie 的属性", () => {
  it("名字、值、Path、HttpOnly、SameSite、Max-Age 一项不少，不写 Domain（I-19）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const reply = await loginAs(api.app, "alice", PASSWORD);
    expect(reply.setCookies).toHaveLength(1);
    const cookie = parseSetCookie(reply.setCookies[0] ?? "");
    expect(cookie.pair).toMatch(/^nexus_session=[A-Za-z0-9_-]{43}$/);
    expect(cookie.attributes).toEqual(COOKIE_ATTRIBUTES);
  });

  it("请求的协议是 https 时加 Secure；http 时不加；协议取最后一跳（I-20）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const plain = await loginAs(api.app, "alice", PASSWORD);
    expect(parseSetCookie(plain.setCookies[0] ?? "").attributes).not.toContain("Secure");
    const secure = await loginAs(api.app, "alice", PASSWORD, { "x-forwarded-proto": "https" });
    expect(parseSetCookie(secure.setCookies[0] ?? "").attributes).toContain("Secure");
    const lastHopIsHttp = await loginAs(api.app, "alice", PASSWORD, {
      "x-forwarded-proto": "https, http",
    });
    expect(parseSetCookie(lastHopIsHttp.setCookies[0] ?? "").attributes).not.toContain("Secure");
    const lastHopIsHttps = await loginAs(api.app, "alice", PASSWORD, {
      "x-forwarded-proto": "http, https",
    });
    expect(parseSetCookie(lastHopIsHttps.setCookies[0] ?? "").attributes).toContain("Secure");
  });
});

describe("有效期与顺延（规格 I-22）", () => {
  it("登录后第 14 天用一次：不重发 cookie，库里的过期时间不动", async () => {
    const api = await signedIn();
    api.clock.tick(14 * DAY_MS);
    const reply = await call(api.app, AUTH.me, { cookie: api.cookie });
    expect(reply.status).toBe(200);
    expect(reply.setCookies).toEqual([]);
    const rows = await sessionRows(database.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.expires_at.getTime()).toBe(EXPIRES);
  });

  it("第 16 天用一次：重发同一个 cookie，过期时间变成第 46 天", async () => {
    const api = await signedIn();
    api.clock.tick(16 * DAY_MS);
    const reply = await call(api.app, AUTH.me, { cookie: api.cookie });
    expect(reply.status).toBe(200);
    expect(reply.setCookies).toHaveLength(1);
    // 同一枚令牌，属性照旧
    const resent = parseSetCookie(reply.setCookies[0] ?? "");
    expect(resent.pair).toBe(api.cookie);
    expect(resent.attributes).toEqual(COOKIE_ATTRIBUTES);
    const rows = await sessionRows(database.db);
    expect(rows[0]?.expires_at.getTime()).toBe(T0.getTime() + 46 * DAY_MS);
    expect(rows[0]?.last_seen_at.getTime()).toBe(T0.getTime() + 16 * DAY_MS);
  });

  it("第 16 天续过一次之后，第 40 天用一次仍得 200：没有绝对上限", async () => {
    const api = await signedIn();
    api.clock.tick(16 * DAY_MS);
    expect((await call(api.app, AUTH.me, { cookie: api.cookie })).status).toBe(200);
    api.clock.tick(24 * DAY_MS);
    expect((await call(api.app, AUTH.me, { cookie: api.cookie })).status).toBe(200);
    expect((await sessionRows(database.db))[0]?.expires_at.getTime()).toBe(
      T0.getTime() + 70 * DAY_MS,
    );
  });

  it("一直没用，满 30 天回 401", async () => {
    const api = await signedIn();
    // 中间一次都不用（用一次就会续期）；到第 30 天整，刚好满
    api.clock.tick(30 * DAY_MS);
    const reply = await call(api.app, AUTH.me, { cookie: api.cookie });
    expect(reply.status).toBe(401);
    expect(reply.error?.code).toBe("auth_required");
    expect(reply.setCookies).toEqual([]);
  });

  it("续期不只发生在我是谁上；而且只动这一个会话，别人的不碰", async () => {
    const api = await signedIn();
    await seedUser(database.db, { username: "other", password: PASSWORD });
    const other = await loginAs(api.app, "other", PASSWORD);
    api.clock.tick(20 * DAY_MS);
    const info = await call(api.app, AUTH.info, { cookie: api.cookie });
    expect(info.status).toBe(200);
    expect(info.setCookies).toHaveLength(1);
    expect(cookieHeader(info.setCookies[0] ?? "")).toBe(api.cookie);
    // 另一个人的会话这次没被用到：还是原来的过期时间
    const rows = await sessionRows(database.db);
    expect(rows.find((row) => row.user_id === api.userId)?.expires_at.getTime()).toBe(
      T0.getTime() + 50 * DAY_MS,
    );
    expect(rows.find((row) => row.user_id !== api.userId)?.expires_at.getTime()).toBe(EXPIRES);
    expect(other.status).toBe(200);
  });
});

describe("退出", () => {
  it("退出：200，清除 cookie 的属性对；被复制走的旧 cookie 立刻失效；发一条事件（I-24）", async () => {
    const api = await signedIn();
    const copy = `nexus_session=${cookieValue(api.cookie)}`;
    const out = await call(api.app, AUTH.logout, {
      method: "POST",
      cookie: api.cookie,
      requestId: "trace-logout",
    });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    const cleared = parseSetCookie(out.setCookies[0] ?? "");
    expect(cleared.pair).toBe("nexus_session=");
    expect(cleared.attributes.slice(0, 3)).toEqual([
      "Max-Age=0",
      "Path=/",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
    expect(cleared.attributes).toContain("HttpOnly");

    expect((await call(api.app, AUTH.me, { cookie: copy })).status).toBe(401);
    expect(await sessionRows(database.db)).toEqual([]);
    const events = await identityEvents(database.db, "identity.logout");
    expect(events).toHaveLength(1);
    // userId 是当事人那一个账号的编号（规格事件表）
    expect(events[0]).toMatchObject({
      source: "identity",
      subject: "alice",
      payload: { userId: api.userId, ip: "unknown" },
      trace_id: "trace-logout",
    });
    expect(out.requestId).toBe("trace-logout");
  });

  it("没登录就退出：401 auth_required（I-25）", async () => {
    const api = await boot({ db: database.db });
    const reply = await call(api.app, AUTH.logout, { method: "POST" });
    expect(reply.status).toBe(401);
    expect(reply.error?.code).toBe("auth_required");
    expect(reply.setCookies).toEqual([]);
  });
});

describe("停用", () => {
  it("开两个会话，停用后都是 401；重新启用后旧 cookie 仍然无效（I-29）", async () => {
    const api = await signedIn();
    const second = await loginAs(api.app, "alice", PASSWORD);
    await api.identity.service.setDisabled(api.userId, true);
    expect((await call(api.app, AUTH.me, { cookie: api.cookie })).status).toBe(401);
    expect((await call(api.app, AUTH.me, { cookie: second.cookie })).status).toBe(401);
    expect(await sessionRows(database.db)).toEqual([]);
    await api.identity.service.setDisabled(api.userId, false);
    expect((await call(api.app, AUTH.me, { cookie: api.cookie })).status).toBe(401);
    // 启用之后用口令能重新登录
    expect((await loginAs(api.app, "alice", PASSWORD)).status).toBe(200);
  });
});
