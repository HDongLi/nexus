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
  type Reply,
  type TestApp,
} from "./testing/kit.ts";
import { PASSWORD, PEOPLE, clearGroups, seedGroup } from "./testing/people.ts";
import { clearProjects } from "./testing/projects.ts";

/**
 * 管账号的另半边竖切（人员规格 G-13、G-14、G-02、G-03、G-34 的 me 半边）：
 * 改号、重置口令、形状不合、旧路径、查一个账号、我是谁不带组。
 * 清单、名录、建号在 users-admin.integration.test.ts；停用启用、护栏、删号在 users-lifecycle。
 */

let database: DatabaseHandle;
let api: TestApp;
let chiefId: string;
let chief: string;
let time: Clock;

beforeAll(async () => {
  database = await createTestDatabase();
  time = clock();
  const session = await boot({ db: database.db, clock: time });
  api = session;
  const user = await seedUser(database.db, {
    username: "chief",
    password: PASSWORD,
    isAdmin: true,
  });
  chiefId = user.id;
  const reply = await loginAs(api.app, "chief", PASSWORD);
  chief = reply.cookie;
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

describe("改号（规格 G-13）", () => {
  it("原值重发一次：200，更新时间和事件数不变；改显示名：事件多一条、更新时间动了（G-13）", async () => {
    const { cookie } = await admin();
    const created = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "alice", password: PASSWORD, displayName: "甲" },
    });
    const id = (created.body as { account: { id: string } }).account.id;
    const eventsBefore = (await identityEvents(database.db)).length;

    const same = await call(api.app, PEOPLE.member(id), {
      method: "PATCH",
      cookie,
      body: { displayName: "甲" },
    });
    expect(same.status).toBe(200);
    const rowAfterSame = (await userRows(database.db)).find((row) => row.id === id);
    expect((same.body as { account: { displayName: string } }).account.displayName).toBe("甲");
    expect((await identityEvents(database.db)).length).toBe(eventsBefore);
    // 拨过表再改：更新时间动了才分得出来（真时钟同一毫秒内分不出）
    time.tick(1000);

    const changed = await call(api.app, PEOPLE.member(id), {
      method: "PATCH",
      cookie,
      body: { displayName: "乙" },
    });
    expect(changed.status).toBe(200);
    expect((changed.body as { account: { displayName: string } }).account.displayName).toBe("乙");
    expect((await userRows(database.db)).find((row) => row.id === id)?.display_name).toBe("乙");
    const events = await identityEvents(database.db, "identity.user.updated");
    expect(events).toHaveLength(1);
    expect(events[0]?.subject).toBe("alice");
    expect(events[0]?.payload).toEqual({
      userId: id,
      actorId: expect.any(String),
      changes: { displayName: { from: "甲", to: "乙" } },
    });
    expect(events[0]?.trace_id).toBe(changed.requestId);
    // 重发那次确实什么都没写：更新时间在两次读之间没变过
    expect((await userRows(database.db)).find((row) => row.id === id)?.updated_at).not.toEqual(
      rowAfterSame?.updated_at,
    );
  });

  it("改管理员位：降级发事件；值没变不发（G-13）", async () => {
    const { cookie } = await admin();
    const created = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "alice", password: PASSWORD, isAdmin: true },
    });
    const id = (created.body as { account: { id: string } }).account.id;
    const same = await call(api.app, PEOPLE.member(id), {
      method: "PATCH",
      cookie,
      body: { isAdmin: true },
    });
    expect(same.status).toBe(200);
    expect(await identityEvents(database.db, "identity.user.updated")).toEqual([]);
    const demote = await call(api.app, PEOPLE.member(id), {
      method: "PATCH",
      cookie,
      body: { isAdmin: false },
    });
    expect(demote.status).toBe(200);
    const events = await identityEvents(database.db, "identity.user.updated");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      userId: id,
      actorId: expect.any(String),
      changes: { isAdmin: { from: true, to: false } },
    });
  });
});

describe("重置口令（规格 G-14）", () => {
  it("给别的账号重置：这个账号的会话全没、操作者的会话不动、新口令能登录、最近改密时间变了（G-14）", async () => {
    const { cookie } = await admin();
    const alice = await seedUser(database.db, { username: "alice", password: PASSWORD });
    const hashBefore = (await userRows(database.db)).find((row) => row.id === alice.id)
      ?.password_hash as string;
    const first = await loginAs(api.app, "alice", PASSWORD);
    const second = await loginAs(api.app, "alice", PASSWORD);
    expect((await call(api.app, "/api/v1/auth/me", { cookie: first.cookie })).status).toBe(200);

    const reply = await call(api.app, PEOPLE.password(alice.id), {
      method: "POST",
      cookie,
      body: { newPassword: "brand-new-password" },
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true });

    expect((await call(api.app, "/api/v1/auth/me", { cookie: first.cookie })).status).toBe(401);
    expect((await call(api.app, "/api/v1/auth/me", { cookie: second.cookie })).status).toBe(401);
    expect((await call(api.app, "/api/v1/auth/me", { cookie })).status).toBe(200);
    expect((await loginAs(api.app, "alice", "brand-new-password")).status).toBe(200);
    expect((await loginAs(api.app, "alice", PASSWORD)).status).toBe(401);

    const row = (await userRows(database.db)).find((candidate) => candidate.id === alice.id);
    expect(row?.password_hash).not.toBe(hashBefore);
    // 事件带被吊销的会话数（规格事件表）
    const events = await identityEvents(database.db, "identity.user.password.reset");
    expect(events).toHaveLength(1);
    expect(events[0]?.subject).toBe("alice");
    expect(events[0]?.payload).toEqual({
      userId: alice.id,
      actorId: expect.any(String),
      revokedSessions: 2,
    });
    expect(events[0]?.trace_id).toBe(reply.requestId);
  });

  it("给自己重置：409 identity_self_change，口令和会话都没动（G-14、G-19）", async () => {
    const { cookie, userId } = await admin();
    const hashBefore = (await userRows(database.db)).find((row) => row.id === userId)
      ?.password_hash as string;
    const reply = await call(api.app, PEOPLE.password(userId), {
      method: "POST",
      cookie,
      body: { newPassword: "brand-new-password" },
    });
    expect(reply.status).toBe(409);
    expect(reply.error?.code).toBe("identity_self_change");
    expect((await userRows(database.db)).find((row) => row.id === userId)?.password_hash).toBe(
      hashBefore,
    );
    expect((await call(api.app, "/api/v1/auth/me", { cookie })).status).toBe(200);
    expect(await identityEvents(database.db, "identity.user.password.reset")).toEqual([]);
  });
});

describe("形状不合与旧路径（规格 G-02、G-03）", () => {
  it("形状不合一律 400 invalid_request：缺用户名、带没声明的键、数组里有重复、编号不是 UUID；现场不变（G-02）", async () => {
    const { cookie } = await admin();
    const groupId = "20000000-0000-4000-8000-00000000000a";
    const before = {
      users: (await userRows(database.db)).length,
      events: (await identityEvents(database.db)).length,
    };
    const bad: Array<[string, () => Promise<Reply>]> = [
      [
        "缺 username",
        () => call(api.app, PEOPLE.users, { method: "POST", cookie, body: { password: PASSWORD } }),
      ],
      [
        "多一个键",
        () =>
          call(api.app, PEOPLE.users, {
            method: "POST",
            cookie,
            body: { username: "a", password: PASSWORD, extra: 1 },
          }),
      ],
      [
        "改号带 username",
        () =>
          call(api.app, PEOPLE.member("30000000-0000-4000-8000-000000000001"), {
            method: "PATCH",
            cookie,
            body: { username: "x", displayName: "甲" },
          }),
      ],
      [
        "改号带 isDisabled",
        () =>
          call(api.app, PEOPLE.member("30000000-0000-4000-8000-000000000001"), {
            method: "PATCH",
            cookie,
            body: { isDisabled: true },
          }),
      ],
      [
        "改号什么都不带",
        () =>
          call(api.app, PEOPLE.member("30000000-0000-4000-8000-000000000001"), {
            method: "PATCH",
            cookie,
            body: {},
          }),
      ],
      ["编号不是 UUID", () => call(api.app, PEOPLE.member("not-a-uuid"), { cookie })],
      [
        "成员数组有重复",
        () =>
          call(api.app, PEOPLE.members(groupId), {
            method: "PUT",
            cookie,
            body: { userIds: [chiefId, chiefId] },
          }),
      ],
      [
        "工程数组有重复",
        () =>
          call(api.app, `/api/v1/groups/${groupId}/projects`, {
            method: "PUT",
            cookie,
            body: {
              projectIds: [
                "30000000-0000-4000-8000-000000000001",
                "30000000-0000-4000-8000-000000000001",
              ],
            },
          }),
      ],
      [
        "数组元素不是编号",
        () =>
          call(api.app, PEOPLE.members(groupId), {
            method: "PUT",
            cookie,
            body: { userIds: ["alice"] },
          }),
      ],
    ];
    for (const [label, run] of bad) {
      const reply = await run();
      expect(reply.status, label).toBe(400);
      expect(reply.error?.code, label).toBe("invalid_request");
    }
    expect((await userRows(database.db)).length).toBe(before.users);
    expect((await identityEvents(database.db)).length).toBe(before.events);
  });

  it("旧路径不保留：十个 /api/identity/* 路径读和写各回 404（G-03）", async () => {
    const old: Array<[string, string]> = [
      ["GET", "/api/identity/users"],
      ["GET", "/api/identity/users/update"],
      ["GET", "/api/identity/users/delete"],
      ["GET", "/api/identity/groups"],
      ["GET", "/api/identity/groups/update"],
      ["GET", "/api/identity/groups/delete"],
      ["GET", "/api/identity/ra"],
      ["GET", "/api/identity/dev-groups"],
      ["GET", "/api/identity/staff-groups"],
      ["GET", "/api/identity/sso-absorb"],
    ];
    expect(old).toHaveLength(10);
    for (const [method, path] of old) {
      for (const verb of [method, method === "GET" ? "POST" : "GET"] as const) {
        const reply = await call(api.app, path, {
          method: verb,
          cookie: chief,
          ...(verb === "GET" ? {} : { body: {} }),
        });
        expect(reply.status, `${verb} ${path}`).toBe(404);
        expect(reply.error?.code, `${verb} ${path}`).toBe("not_found");
      }
    }
  });

  it("回应的正文里不出库里的散列串（G-05）", async () => {
    const { cookie } = await admin();
    const created = await call(api.app, PEOPLE.users, {
      method: "POST",
      cookie,
      body: { username: "alice", password: PASSWORD },
    });
    const id = (created.body as { account: { id: string } }).account.id;
    const hash = (await userRows(database.db)).find((row) => row.id === id)
      ?.password_hash as string;
    expect(hash).toMatch(/^\$argon2id\$/);
    const bodies: string[] = [
      JSON.stringify((await call(api.app, PEOPLE.users, { cookie })).body),
      JSON.stringify((await call(api.app, PEOPLE.member(id), { cookie })).body),
      JSON.stringify(created.body),
      JSON.stringify(
        (
          await call(api.app, PEOPLE.member(id), {
            method: "PATCH",
            cookie,
            body: { displayName: "甲" },
          })
        ).body,
      ),
      JSON.stringify(
        (
          await call(api.app, PEOPLE.people, {
            cookie: (await loginAs(api.app, "alice", PASSWORD)).cookie,
          })
        ).body,
      ),
    ];
    expect(bodies.filter((body) => body.includes("alice")).length).toBeGreaterThan(0);
    for (const secret of [hash, ...hash.split("$").slice(2), PASSWORD]) {
      expect(secret.length, secret.slice(0, 12)).toBeGreaterThan(0);
      expect(
        bodies.filter((body) => body.includes(secret)),
        secret.slice(0, 12),
      ).toEqual([]);
    }
  });
});

describe("访问闸不带组的路由（规格 G-34：对外的 me 不带组）", () => {
  it("我是谁还是恰好四个键，正文里连 groupIds 这个名字都没有（G-34）", async () => {
    const { cookie, userId } = await admin();
    const reply = await call(api.app, "/api/v1/auth/me", { cookie });
    expect(reply.status).toBe(200);
    const user = (reply.body as { user: Record<string, unknown> }).user;
    expect(Object.keys(user).sort()).toEqual(["displayName", "id", "isAdmin", "username"]);
    expect(JSON.stringify(reply.body)).not.toContain("groupIds");
    // 组的成员关系在也不影响：把管理员放进一个组，我是谁照旧四个键
    await seedGroup(database.db, { name: "dev", memberIds: [userId] });
    const again = await call(api.app, "/api/v1/auth/me", { cookie });
    expect(Object.keys((again.body as { user: Record<string, unknown> }).user).sort()).toEqual([
      "displayName",
      "id",
      "isAdmin",
      "username",
    ]);
  });
});
