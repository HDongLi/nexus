import type { DatabaseHandle } from "@nexus/db";
import { createIdentityRepo, type IdentityRepo } from "@nexus/identity";
import { sql } from "drizzle-orm";
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
import {
  PASSWORD,
  PEOPLE,
  clearGroups,
  groupRows,
  memberRows,
  seedGroup,
} from "./testing/people.ts";
import {
  clearProjects,
  projectGroupRows,
  projectsEvents,
  seedProject,
} from "./testing/projects.ts";

/**
 * 用户组的竖切（人员规格 G-25 到 G-30，加 G-36 到 G-39 里组的那一半）：
 * 建组、组名不分大小写唯一、换成员、改名、删组；事件的内容、同事务回滚、不重复发。
 */

let database: DatabaseHandle;
let api: TestApp;
let chief: string;
/** 可以拨的时钟：改名的用例要断言更新时间动了，真时钟同一毫秒内分不出来。 */
let time: Clock;

beforeAll(async () => {
  database = await createTestDatabase();
  time = clock();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await clearProjects(database.db);
  await clearGroups(database.db);
  await clearIdentity(database.db);
  api = await boot({ db: database.db, clock: time });
  await seedUser(database.db, { username: "chief", password: PASSWORD, isAdmin: true });
  chief = (await loginAs(api.app, "chief", PASSWORD)).cookie;
});

/** 一个普通账号（停用的给 disabledAt），回编号。 */
async function member(username: string, disabled = false): Promise<string> {
  const user = await seedUser(database.db, {
    username,
    password: PASSWORD,
    ...(disabled ? { disabledAt: new Date() } : {}),
  });
  return user.id;
}

const MISSING_ID = "30000000-0000-4000-8000-0000000000ff";

describe("建组（规格 G-25 到 G-27）", () => {
  it("带两个成员建组：读表逐字段对上；读它的可见工程得空集（G-26）", async () => {
    const alice = await member("alice");
    const bob = await member("bob");
    const reply = await call(api.app, PEOPLE.groups, {
      method: "POST",
      cookie: chief,
      body: { name: "开发组", memberIds: [alice, bob] },
    });
    expect(reply.status).toBe(201);
    const group = (reply.body as { group: Record<string, unknown> }).group;
    const rows = await groupRows(database.db);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("组应当已经写进去");
    expect(row.name).toBe("开发组");
    expect(group).toEqual({
      id: row.id,
      name: "开发组",
      memberIds: [alice, bob],
      createdAt: group.createdAt,
      updatedAt: group.createdAt,
    });
    expect(await memberRows(database.db)).toHaveLength(2);
    // 可见的工程是空集（规格 G-26）；那两条路由归工程模块（G-31）
    const projects = await call(api.app, `${PEOPLE.group(row.id)}/projects`, {
      cookie: chief,
    });
    expect(projects.status).toBe(200);
    expect(projects.body).toEqual({ projectIds: [] });
    // 事件（规格事件表）
    const created = await identityEvents(database.db, "identity.group.created");
    expect(created).toHaveLength(1);
    expect(created[0]?.subject).toBe(row.id);
    expect(created[0]?.payload).toEqual({
      groupId: row.id,
      actorId: expect.any(String),
      name: "开发组",
    });
    expect(created[0]?.trace_id).toBe(reply.requestId);
  });

  it("组名不分大小写唯一：建 dev 后再建 Dev 得 409 identity_group_name_taken（G-25）", async () => {
    const first = await call(api.app, PEOPLE.groups, {
      method: "POST",
      cookie: chief,
      body: { name: "dev" },
    });
    expect(first.status).toBe(201);
    const second = await call(api.app, PEOPLE.groups, {
      method: "POST",
      cookie: chief,
      body: { name: "Dev" },
    });
    expect(second.status).toBe(409);
    expect(second.error?.code).toBe("identity_group_name_taken");
    expect(await groupRows(database.db)).toHaveLength(1);
  });

  it("组名的形状：首尾空白收下存的是去掉后的值；空串、65 个码点、含换行 400（G-25）", async () => {
    const ok = await call(api.app, PEOPLE.groups, {
      method: "POST",
      cookie: chief,
      body: { name: "  开发组  " },
    });
    expect(ok.status).toBe(201);
    expect((ok.body as { group: { name: string } }).group.name).toBe("开发组");

    for (const name of ["   ", "组".repeat(65), "带\n换行的组名"]) {
      const bad = await call(api.app, PEOPLE.groups, {
        method: "POST",
        cookie: chief,
        body: { name },
      });
      expect(bad.status, name.slice(0, 6)).toBe(400);
      expect(bad.error?.code, name.slice(0, 6)).toBe("invalid_request");
    }
    expect(await groupRows(database.db)).toHaveLength(1);
  });

  it("成员必须是存在的账号：不存在的回 400，整份请求都不生效；停用的算存在（G-27）", async () => {
    const alice = await member("alice");
    await seedUser(database.db, { username: "ghost", password: PASSWORD, disabledAt: new Date() });
    const ghostId = (await userRows(database.db)).find((row) => row.username === "ghost")
      ?.id as string;

    const bad = await call(api.app, PEOPLE.groups, {
      method: "POST",
      cookie: chief,
      body: { name: "dev", memberIds: [alice, MISSING_ID] },
    });
    expect(bad.status).toBe(400);
    expect(bad.error?.code).toBe("invalid_request");
    expect(await groupRows(database.db)).toEqual([]);
    expect(await memberRows(database.db)).toEqual([]);
    expect(await identityEvents(database.db, "identity.group.created")).toEqual([]);

    const ok = await call(api.app, PEOPLE.groups, {
      method: "POST",
      cookie: chief,
      body: { name: "dev", memberIds: [alice, ghostId] },
    });
    expect(ok.status).toBe(201);
    expect((ok.body as { group: { memberIds: string[] } }).group.memberIds).toHaveLength(2);
  });
});

describe("换成员与改名（规格 G-28、G-29、G-39）", () => {
  interface Setup {
    groupId: string;
    alice: string;
    bob: string;
  }

  async function setup(): Promise<Setup> {
    const alice = await member("alice");
    const bob = await member("bob");
    const created = await call(api.app, PEOPLE.groups, {
      method: "POST",
      cookie: chief,
      body: { name: "dev", memberIds: [alice, bob] },
    });
    return { groupId: (created.body as { group: { id: string } }).group.id, alice, bob };
  }

  it("整体替换：[甲,乙] 换成 [乙,甲] 得 200 事件数不变；换成 [甲] 得 200，读表只剩甲，事件多一条（G-28）", async () => {
    const { groupId, alice, bob } = await setup();
    const swap = await call(api.app, PEOPLE.members(groupId), {
      method: "PUT",
      cookie: chief,
      body: { userIds: [bob, alice] },
    });
    expect(swap.status).toBe(200);
    expect((swap.body as { group: { memberIds: string[] } }).group.memberIds.sort()).toEqual(
      [alice, bob].sort(),
    );
    expect(await identityEvents(database.db, "identity.group.members.changed")).toEqual([]);

    const shrink = await call(api.app, PEOPLE.members(groupId), {
      method: "PUT",
      cookie: chief,
      body: { userIds: [alice] },
    });
    expect(shrink.status).toBe(200);
    expect((shrink.body as { group: { memberIds: string[] } }).group.memberIds).toEqual([alice]);
    expect((await memberRows(database.db)).map((row) => row.user_id)).toEqual([alice]);
    const changed = await identityEvents(database.db, "identity.group.members.changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]?.subject).toBe(groupId);
    // from、to 按原样全量记（规格事件表）；from 是存下来的次序（仓储按编号排，次序稳定）
    expect(changed[0]?.payload).toEqual({
      groupId,
      actorId: expect.any(String),
      changes: { members: { from: [alice, bob].sort(), to: [alice] } },
    });
    expect(changed[0]?.trace_id).toBe(shrink.requestId);
  });

  it("改名：名字变了写库、更新更新时间、发事件，成员不动；名字没变不写不发（G-29）", async () => {
    const { groupId, alice, bob } = await setup();
    const before = (await groupRows(database.db)).find((row) => row.id === groupId);
    expect(before?.updated_at).toEqual(before?.created_at);

    const same = await call(api.app, PEOPLE.group(groupId), {
      method: "PATCH",
      cookie: chief,
      body: { name: "dev" },
    });
    expect(same.status).toBe(200);
    expect(await identityEvents(database.db, "identity.group.renamed")).toEqual([]);
    // 拨过表再改：更新时间动了才分得出来（真时钟同一毫秒内分不出）
    time.tick(1000);

    const renamed = await call(api.app, PEOPLE.group(groupId), {
      method: "PATCH",
      cookie: chief,
      body: { name: "平台组" },
    });
    expect(renamed.status).toBe(200);
    expect((renamed.body as { group: { name: string } }).group.name).toBe("平台组");
    const detail = await call(api.app, PEOPLE.group(groupId), { cookie: chief });
    expect((detail.body as { group: { memberIds: string[] } }).group.memberIds.sort()).toEqual(
      [alice, bob].sort(),
    );
    const events = await identityEvents(database.db, "identity.group.renamed");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      groupId,
      actorId: expect.any(String),
      changes: { name: { from: "dev", to: "平台组" } },
    });
    const after = (await groupRows(database.db)).find((row) => row.id === groupId);
    expect(after?.updated_at).not.toEqual(before?.updated_at);
  });

  it("改名撞上只差大小写的组名：409 identity_group_name_taken（G-25）", async () => {
    await call(api.app, PEOPLE.groups, { method: "POST", cookie: chief, body: { name: "ops" } });
    const { groupId } = await setup();
    const reply = await call(api.app, PEOPLE.group(groupId), {
      method: "PATCH",
      cookie: chief,
      body: { name: "Ops" },
    });
    expect(reply.status).toBe(409);
    expect(reply.error?.code).toBe("identity_group_name_taken");
  });

  it("换成员时给不存在的账号编号：400，组和成员关系都没变（G-27）", async () => {
    const { groupId, alice, bob } = await setup();
    const reply = await call(api.app, PEOPLE.members(groupId), {
      method: "PUT",
      cookie: chief,
      body: { userIds: [alice, MISSING_ID] },
    });
    expect(reply.status).toBe(400);
    expect(reply.error?.code).toBe("invalid_request");
    expect((await memberRows(database.db)).map((row) => row.user_id).sort()).toEqual(
      [alice, bob].sort(),
    );
    expect(await identityEvents(database.db, "identity.group.members.changed")).toEqual([]);
  });

  it("事件和写入同一个事务：写入之后抛错，改名、换成员都回滚，事件表没有新行（G-38）", async () => {
    const { groupId, alice, bob } = await setup();
    const real = createIdentityRepo();
    const boomRepo: IdentityRepo = {
      ...real,
      groups: {
        ...real.groups,
        rename: async (...args: Parameters<typeof real.groups.rename>) => {
          await real.groups.rename(...args);
          throw new Error("写入之后磁盘满了");
        },
        replaceMembers: async (...args: Parameters<typeof real.groups.replaceMembers>) => {
          await real.groups.replaceMembers(...args);
          throw new Error("写入之后磁盘满了");
        },
      },
    };
    const boom = await boot({ db: database.db, repo: boomRepo });
    const chiefCookie = (await loginAs(boom.app, "chief", PASSWORD)).cookie;

    const renamed = await call(boom.app, PEOPLE.group(groupId), {
      method: "PATCH",
      cookie: chiefCookie,
      body: { name: "平台组" },
    });
    expect(renamed.status).toBe(500);
    const swapped = await call(boom.app, PEOPLE.members(groupId), {
      method: "PUT",
      cookie: chiefCookie,
      body: { userIds: [alice] },
    });
    expect(swapped.status).toBe(500);
    expect(await identityEvents(database.db, "identity.group.renamed")).toEqual([]);
    expect(await identityEvents(database.db, "identity.group.members.changed")).toEqual([]);
    expect((await memberRows(database.db)).map((row) => row.user_id).sort()).toEqual(
      [alice, bob].sort(),
    );
    expect((await groupRows(database.db)).find((row) => row.id === groupId)?.name).toBe("dev");
  });
});

describe("删组（规格 G-30、G-39）", () => {
  it("删组：组没了，账号和工程都不动；关系表的行随外键没了，不发工程的事件（G-30）", async () => {
    const alice = await member("alice");
    const bob = await member("bob");
    const group = await seedGroup(database.db, { name: "dev", memberIds: [alice, bob] });
    const project = await seedProject(database.db, { slug: "alpha", createdById: alice });
    await database.db.execute(
      sql`insert into project_groups (project_id, group_id) values (${project.id}, ${group.id})`,
    );
    expect(await projectGroupRows(database.db)).toHaveLength(1);

    const reply = await call(api.app, PEOPLE.group(group.id), { method: "DELETE", cookie: chief });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true });
    expect(await groupRows(database.db)).toEqual([]);
    expect(await memberRows(database.db)).toEqual([]);
    // 账号不删、工程不删（规格 G-30）
    expect((await userRows(database.db)).map((row) => row.username)).toEqual([
      "alice",
      "bob",
      "chief",
    ]);
    expect(await projectGroupRows(database.db)).toEqual([]);
    // 事件只发组的那一条；工程的事件一条都没有（规格 G-39）
    const deleted = await identityEvents(database.db, "identity.group.deleted");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.subject).toBe(group.id);
    expect(deleted[0]?.payload).toEqual({
      groupId: group.id,
      actorId: expect.any(String),
      name: "dev",
      memberCount: 2,
    });
    expect(deleted[0]?.trace_id).toBe(reply.requestId);
    expect(await projectsEvents(database.db)).toEqual([]);
  });

  it("删一个不存在的组：404 not_found（G-01 的表）", async () => {
    const reply = await call(api.app, PEOPLE.group("20000000-0000-4000-8000-0000000000ff"), {
      method: "DELETE",
      cookie: chief,
    });
    expect(reply.status).toBe(404);
    expect(reply.error?.code).toBe("not_found");
  });
});
