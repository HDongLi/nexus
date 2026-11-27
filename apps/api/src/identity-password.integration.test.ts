import type { DatabaseHandle } from "@nexus/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH,
  boot,
  call,
  clearIdentity,
  createTestDatabase,
  failureRows,
  identityEvents,
  loginAs,
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

const OLD = "alice-password-1";
const NEXT = "brand-new-password";
const change = (
  app: Awaited<ReturnType<typeof boot>>["app"],
  cookie: string,
  currentPassword: string,
  newPassword: string,
  requestId?: string,
) =>
  call(app, AUTH.password, {
    method: "POST",
    cookie,
    body: { currentPassword, newPassword },
    ...(requestId === undefined ? {} : { requestId }),
  });

describe("本人改密", () => {
  it("成功：其它会话失效，当前会话拿到新 cookie 继续，旧 cookie 失效；口令真的换了；事件带被吊销的数量（I-30）", async () => {
    const api = await boot({ db: database.db });
    const alice = await seedUser(database.db, { username: "alice", password: OLD });
    const before = (await userRows(database.db))[0]?.password_hash;
    const a = await loginAs(api.app, "alice", OLD);
    const b = await loginAs(api.app, "alice", OLD);
    expect(a.cookie).not.toBe(b.cookie);

    const out = await change(api.app, a.cookie, OLD, NEXT, "trace-change");
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    expect(out.setCookies).toHaveLength(1);
    const fresh = out.setCookies[0]?.split(";")[0] ?? "";
    expect(fresh).toMatch(/^nexus_session=[A-Za-z0-9_-]{43}$/);
    expect(fresh).not.toBe(a.cookie);

    // B 被吊销；A 的旧 cookie 也失效了；A 的新 cookie 能继续用
    expect((await call(api.app, AUTH.me, { cookie: b.cookie })).status).toBe(401);
    expect((await call(api.app, AUTH.me, { cookie: a.cookie })).status).toBe(401);
    expect((await call(api.app, AUTH.me, { cookie: fresh })).status).toBe(200);
    // 库里只剩一条会话，令牌是新的
    const rows = await sessionRows(database.db);
    expect(rows).toHaveLength(1);

    expect((await loginAs(api.app, "alice", OLD)).status).toBe(401);
    expect((await loginAs(api.app, "alice", NEXT)).status).toBe(200);
    const after = (await userRows(database.db))[0]?.password_hash;
    expect(after).not.toBe(before);
    expect(after).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(JSON.stringify(out.body)).not.toContain(NEXT);

    const events = await identityEvents(database.db, "identity.password.changed");
    expect(events).toHaveLength(1);
    // userId 是当事人那一个账号的编号（规格事件表）
    expect(events[0]).toMatchObject({
      source: "identity",
      subject: "alice",
      payload: { userId: alice.id, ip: "unknown", revokedSessions: 1 },
      trace_id: out.requestId,
    });
    expect(out.requestId).toBe("trace-change");
  });

  it("旧口令不对：400 auth_current_password_wrong，失败记录多一条（I-31）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: OLD });
    const a = await loginAs(api.app, "alice", OLD);
    expect(await failureRows(database.db)).toEqual([]);
    const out = await change(api.app, a.cookie, "not-the-old-one", NEXT);
    expect(out.status).toBe(400);
    expect(out.error?.code).toBe("auth_current_password_wrong");
    expect(out.setCookies).toEqual([]);
    expect(await failureRows(database.db)).toContainEqual(
      expect.objectContaining({ username: "alice", failure_count: 1 }),
    );
    // 这一片不为改密失败发事件
    expect(await identityEvents(database.db, "identity.password.changed")).toEqual([]);
    // 口令没被换掉
    expect((await loginAs(api.app, "alice", OLD)).status).toBe(200);
  });

  it("新口令太短：400 auth_password_too_weak；这一项查在旧口令之前，所以不记失败（I-32）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: OLD });
    const a = await loginAs(api.app, "alice", OLD);
    // 旧口令故意写错：要是先验了旧口令，就会多一条失败记录
    const out = await change(api.app, a.cookie, "not-the-old-one", "short-7");
    expect(out.status).toBe(400);
    expect(out.error?.code).toBe("auth_password_too_weak");
    expect(await failureRows(database.db)).toEqual([]);
    // 只查长度，不查字符种类：全是同一个字母的 8 个字符也收
    const fine = await change(api.app, a.cookie, OLD, "aaaaaaaa");
    expect(fine.status).toBe(200);
  });

  it("口令最短长度读的是配置：设成 12，8 个字符的新口令被拒（I-32）", async () => {
    const api = await boot({ db: database.db, passwordMinLength: 12 });
    await seedUser(database.db, { username: "alice", password: OLD });
    const a = await loginAs(api.app, "alice", OLD);
    const out = await change(api.app, a.cookie, OLD, "short-7".padEnd(8, "x"));
    expect(out.status).toBe(400);
    expect(out.error?.code).toBe("auth_password_too_weak");
    expect(out.error?.message).toContain("12");
    expect((await change(api.app, a.cookie, OLD, "long-enough-pw")).status).toBe(200);
  });

  it("新口令和旧口令相同：400 auth_password_reused（I-33）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: OLD });
    const a = await loginAs(api.app, "alice", OLD);
    const out = await change(api.app, a.cookie, OLD, OLD);
    expect(out.status).toBe(400);
    expect(out.error?.code).toBe("auth_password_reused");
    expect(await failureRows(database.db)).toEqual([]);
  });

  it("这个用户名处于锁定时，改密回 429 auth_locked_out（I-31）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: OLD });
    const a = await loginAs(api.app, "alice", OLD);
    for (let i = 0; i < 5; i++) {
      expect((await change(api.app, a.cookie, "not-the-old-one", NEXT)).status).toBe(400);
    }
    const locked = await change(api.app, a.cookie, OLD, NEXT);
    expect(locked.status).toBe(429);
    expect(locked.error?.code).toBe("auth_locked_out");
    expect(locked.error?.details?.retryAfterSeconds).toBe(900);
    // 口令没被换掉
    expect((await userRows(database.db))[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(await identityEvents(database.db, "identity.password.changed")).toEqual([]);
  });

  it("改密成功不清失败记录（I-31）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: OLD });
    const a = await loginAs(api.app, "alice", OLD);
    await change(api.app, a.cookie, "not-the-old-one", NEXT);
    expect((await change(api.app, a.cookie, OLD, NEXT)).status).toBe(200);
    expect(await failureRows(database.db)).toContainEqual(
      expect.objectContaining({ username: "alice", failure_count: 1 }),
    );
  });

  it("只吊销自己的其它会话，别人的会话不受影响", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: OLD });
    await seedUser(database.db, { username: "bob", password: OLD });
    const a = await loginAs(api.app, "alice", OLD);
    await loginAs(api.app, "alice", OLD);
    const bob = await loginAs(api.app, "bob", OLD);
    const out = await change(api.app, a.cookie, OLD, NEXT);
    expect(out.status).toBe(200);
    const rows = await sessionRows(database.db);
    expect(rows).toHaveLength(2);
    expect((await call(api.app, AUTH.me, { cookie: bob.cookie })).status).toBe(200);
  });

  it("要登录：没登录 401；请求体不合形状 400 invalid_request，什么都不记", async () => {
    const api = await boot({ db: database.db });
    expect((await change(api.app, "", OLD, NEXT)).status).toBe(401);
    await seedUser(database.db, { username: "alice", password: OLD });
    const a = await loginAs(api.app, "alice", OLD);
    for (const body of [
      { currentPassword: "", newPassword: NEXT },
      { currentPassword: OLD, newPassword: "x".repeat(129) },
      { currentPassword: OLD },
    ]) {
      const out = await call(api.app, AUTH.password, { method: "POST", cookie: a.cookie, body });
      expect(out.status, JSON.stringify(body)).toBe(400);
      expect(out.error?.code, JSON.stringify(body)).toBe("invalid_request");
    }
    expect(await failureRows(database.db)).toEqual([]);
  });
});
