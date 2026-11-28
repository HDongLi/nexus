import type { DatabaseHandle } from "@nexus/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  boot,
  call,
  clearIdentity,
  clock,
  createTestDatabase,
  identityEvents,
  loginAs,
  seedUser,
  userRows,
  type Clock,
  type TestApp,
} from "./testing/kit.ts";
import { PASSWORD, PEOPLE, clearGroups } from "./testing/people.ts";
import { clearProjects } from "./testing/projects.ts";

/**
 * 管账号的竖切前半（人员规格 G-01 的级别、G-05 到 G-11）：访问级别、人员清单、同事名录、建号。
 * 走真路由、读真表。改号、重置口令在 users-update，停用启用、护栏、删号在 users-lifecycle。
 */

let database: DatabaseHandle;
let api: TestApp;
let time: Clock;

beforeAll(async () => {
  database = await createTestDatabase();
  // 拨表用：改号那组要断言更新时间动了，真时钟同一毫秒内分不出来
  time = clock();
  api = await boot({ db: database.db, clock: time });
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await clearProjects(database.db);
  await clearGroups(database.db);
  await clearIdentity(database.db);
});

/** 再登录一次管理员：上面那份 cookie 是文件共用的，clearIdentity 之后会失效。 */
async function admin(): Promise<{ api: TestApp; userId: string; cookie: string }> {
  const user = await seedUser(database.db, {
    username: "chief",
    password: PASSWORD,
    isAdmin: true,
  });
  const reply = await loginAs(api.app, "chief", PASSWORD);
  return { api, userId: user.id, cookie: reply.cookie };
}

describe("访问级别（规格 G-01 的表）", () => {
  it("没登录：管账号的路由都 401 auth_required；同事名录也 401", async () => {
    for (const [method, path] of [
      ["GET", PEOPLE.users],
      ["POST", PEOPLE.users],
      ["GET", PEOPLE.member("30000000-0000-4000-8000-000000000001")],
      ["PATCH", PEOPLE.member("30000000-0000-4000-8000-000000000001")],
      ["POST", PEOPLE.password("30000000-0000-4000-8000-000000000001")],
      ["POST", PEOPLE.disable("30000000-0000-4000-8000-000000000001")],
      ["POST", PEOPLE.enable("30000000-0000-4000-8000-000000000001")],
      ["DELETE", PEOPLE.member("30000000-0000-4000-8000-000000000001")],
      ["GET", PEOPLE.people],
    ] as const) {
      const reply = await call(api.app, path, {
        method,
        ...(method === "GET" ? {} : { body: {} }),
      });
      expect(reply.status, `${method} ${path}`).toBe(401);
      expect(reply.error?.code, `${method} ${path}`).toBe("auth_required");
    }
  });

  it("已登录但不是管理员：admin 级路由 403 auth_forbidden；同事名录照常 200", async () => {
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const alice = await loginAs(api.app, "alice", PASSWORD);
    for (const [method, path] of [
      ["GET", PEOPLE.users],
      ["POST", PEOPLE.users],
      ["GET", PEOPLE.groups],
      ["POST", PEOPLE.groups],
    ] as const) {
      const reply = await call(api.app, path, {
        method,
        cookie: alice.cookie,
        ...(method === "GET" ? {} : { body: { name: "x" } }),
      });
      expect(reply.status, `${method} ${path}`).toBe(403);
      expect(reply.error?.code, `${method} ${path}`).toBe("auth_forbidden");
    }
    const people = await call(api.app, PEOPLE.people, { cookie: alice.cookie });
    expect(people.status).toBe(200);
  });
});

describe("人员清单与同事名录（规格 G-06、G-07）", () => {
  it("清单：三个账号、停用其中一个——三行，键恰好七个，停用那行 isDisabled 为真（G-06）", async () => {
    const { cookie } = await admin();
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const bob = await seedUser(database.db, { username: "bob", password: PASSWORD });
    await seedUser(database.db, { username: "carol", password: PASSWORD, disabledAt: new Date() });

    const reply = await call(api.app, PEOPLE.users, { cookie });
    expect(reply.status).toBe(200);
    const accounts = (reply.body as { accounts: Array<Record<string, unknown>> }).accounts;
    expect(accounts.map((account) => account.username)).toEqual(["alice", "bob", "carol", "chief"]);
    for (const account of accounts) {
      expect(Object.keys(account).sort()).toEqual([
        "createdAt",
        "displayName",
        "id",
        "isAdmin",
        "isDisabled",
        "passwordChangedAt",
        "username",
      ]);
    }
    expect(accounts.find((account) => account.username === "carol")?.isDisabled).toBe(true);
    expect(accounts.find((account) => account.username === "bob")?.isDisabled).toBe(false);
    expect(accounts.find((account) => account.username === "bob")?.id).toBe(bob.id);
  });

  it("同事名录：非管理员调得通，只列启用的，每条恰好四个键（G-07）", async () => {
    await admin();
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    await seedUser(database.db, { username: "bob", password: PASSWORD, disabledAt: new Date() });
    const alice = await loginAs(api.app, "alice", PASSWORD);

    const reply = await call(api.app, PEOPLE.people, { cookie: alice.cookie });
    expect(reply.status).toBe(200);
    const people = (reply.body as { people: Array<Record<string, unknown>> }).people;
    // alice 和 chief 启用着；bob 停用了不列（规格 G-07）
    expect(people.map((person) => person.username)).toEqual(["alice", "chief"]);
    for (const person of people) {
      expect(Object.keys(person).sort()).toEqual(["displayName", "id", "isAdmin", "username"]);
    }
    // 正文里连「isDisabled」这个名字都没有
    expect(JSON.stringify(reply.body)).not.toContain("isDisabled");
  });
});

describe("建号（规格 G-08 到 G-11）", () => {
  it("建号：逐字段对上；显示名没给等于用户名；isAdmin 没给是否（G-08）", async () => {
    const { cookie } = await admin();
    const before = await identityEvents(database.db);
    const reply = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "alice", password: PASSWORD, displayName: "甲", isAdmin: true },
    });
    expect(reply.status).toBe(201);
    const account = (reply.body as { account: Record<string, unknown> }).account;
    const rows = await userRows(database.db);
    expect(rows).toHaveLength(2);
    const row = rows.find((candidate) => candidate.username === "alice") as Record<string, unknown>;
    expect(row.username).toBe("alice");
    expect(row.display_name).toBe("甲");
    expect(row.is_admin).toBe(true);
    expect(row.disabled_at).toBeNull();
    expect(String(row.password_hash)).toMatch(/^\$argon2id\$/);
    expect(row.created_at).toEqual(row.updated_at);
    expect(account).toEqual({
      id: row.id,
      username: "alice",
      displayName: "甲",
      isAdmin: true,
      isDisabled: false,
      createdAt: account.createdAt,
      passwordChangedAt: account.passwordChangedAt,
    });

    const plain = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "bob", password: PASSWORD },
    });
    expect(plain.status).toBe(201);
    expect((plain.body as { account: { displayName: string; isAdmin: boolean } }).account).toEqual(
      expect.objectContaining({ displayName: "bob", isAdmin: false }),
    );
    // 事件：管理员建的带 via: admin 和 actorId（规格事件表）
    const events = await identityEvents(database.db, "identity.user.created");
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toEqual({
      userId: row.id,
      isAdmin: true,
      via: "admin",
      actorId: expect.any(String),
    });
    expect(before.filter((event) => event.type === "identity.user.created")).toHaveLength(0);
  });

  it("用户名只差大小写也算占用：建 alice 后再建 Alice 得 409 identity_username_taken（G-09）", async () => {
    const { cookie } = await admin();
    expect(
      (
        await call(api.app, PEOPLE.users, {
          method: "POST",
          cookie,
          body: { username: "alice", password: PASSWORD },
        })
      ).status,
    ).toBe(201);
    const reply = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "Alice", password: PASSWORD },
    });
    expect(reply.status).toBe(409);
    expect(reply.error?.code).toBe("identity_username_taken");
    expect(await userRows(database.db)).toHaveLength(2);
  });

  it("初始口令：短一个字符得 400 auth_password_too_weak，账号数不变；128 个字符得 201（G-10）", async () => {
    const { cookie } = await admin();
    const short = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "alice", password: "short-7" },
    });
    expect(short.status).toBe(400);
    expect(short.error?.code).toBe("auth_password_too_weak");
    expect(await userRows(database.db)).toHaveLength(1);

    const ok = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "alice", password: "a".repeat(128) },
    });
    expect(ok.status).toBe(201);
    expect(await userRows(database.db)).toHaveLength(2);
  });

  it("不建占位号：请求体里没有 password 得 400 invalid_request，账号数不变（G-11）", async () => {
    const { cookie } = await admin();
    const reply = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "alice" },
    });
    expect(reply.status).toBe(400);
    expect(reply.error?.code).toBe("invalid_request");
    expect(await userRows(database.db)).toHaveLength(1);
  });

  it("显示名首尾带空白建号，读表是去掉空白后的值（G-12）", async () => {
    const { cookie } = await admin();
    const reply = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "alice", password: PASSWORD, displayName: "  甲  " },
    });
    expect(reply.status).toBe(201);
    const rows = await userRows(database.db);
    expect(rows.find((row) => row.username === "alice")?.display_name).toBe("甲");
  });
});

describe("查一个账号（规格 G-01 的表）", () => {
  it("按编号查得到；查不到 404，和不是 UUID 的形状两回事", async () => {
    const { cookie } = await admin();
    const created = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "alice", password: PASSWORD },
    });
    const id = (created.body as { account: { id: string } }).account.id;
    const found = await call(api.app, PEOPLE.member(id), { cookie });
    expect(found.status).toBe(200);
    expect((found.body as { account: { username: string } }).account.username).toBe("alice");
    const missing = await call(api.app, PEOPLE.member("30000000-0000-4000-8000-0000000000ff"), {
      cookie,
    });
    expect(missing.status).toBe(404);
    expect(missing.error?.code).toBe("not_found");
  });
});
