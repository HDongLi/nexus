import type { DatabaseHandle } from "@nexus/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  boot,
  call,
  clearIdentity,
  createTestDatabase,
  identityEvents,
  loginAs,
  seedUser,
  sessionRows,
  userRows,
  type TestApp,
} from "./testing/kit.ts";
import { PASSWORD, PEOPLE, clearGroups, seedGroup } from "./testing/people.ts";
import { clearProjects, projectRows, seedProject } from "./testing/projects.ts";

/**
 * 管账号的另半边（人员规格 G-15 到 G-23）：停用启用（含停用不摘组）、护栏的最后一个管理员、
 * 不动自己、删号（建过工程的不删、会话成员一起没、同名可重建）。
 * 建过工程那句用种进表的工程行拦：引用约束只看行，不用真建仓库。
 */

let database: DatabaseHandle;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await clearProjects(database.db);
  await clearGroups(database.db);
  await clearIdentity(database.db);
});

/** 一个管理员加一个普通账号，各带一份登录。每个用例各造各的：账号表上个用例清掉了。 */
async function troupe(): Promise<{
  app: TestApp["app"];
  chiefId: string;
  chief: string;
  aliceId: string;
  alice: string;
}> {
  const app = await boot({ db: database.db });
  const chief = await seedUser(database.db, {
    username: "chief",
    password: PASSWORD,
    isAdmin: true,
  });
  const alice = await seedUser(database.db, { username: "alice", password: PASSWORD });
  const chiefLogin = await loginAs(app.app, "chief", PASSWORD);
  const aliceLogin = await loginAs(app.app, "alice", PASSWORD);
  return {
    app: app.app,
    chiefId: chief.id,
    chief: chiefLogin.cookie,
    aliceId: alice.id,
    alice: aliceLogin.cookie,
  };
}

describe("停用与启用（规格 G-15 到 G-17）", () => {
  it("停用：会话同一个事务里删光，旧 cookie 全 401，事件带操作者；启用后旧 cookie 仍无效，口令能重新登录（G-15、G-16）", async () => {
    const { app, chiefId, chief, aliceId, alice } = await troupe();
    const second = await loginAs(app, "alice", PASSWORD);

    const reply = await call(app, PEOPLE.disable(aliceId), { method: "POST", cookie: chief });
    expect(reply.status).toBe(200);
    expect((reply.body as { account: { isDisabled: boolean } }).account.isDisabled).toBe(true);
    expect(
      await sessionRows(database.db).then((rows) => rows.filter((row) => row.user_id === aliceId)),
    ).toEqual([]);
    expect((await call(app, "/api/v1/auth/me", { cookie: alice })).status).toBe(401);
    expect((await call(app, "/api/v1/auth/me", { cookie: second.cookie })).status).toBe(401);
    // 同事名录也要登录：停用的人持旧 cookie 调它同样 401 auth_required（G-15）
    const people = await call(app, PEOPLE.people, { cookie: alice });
    expect(people.status).toBe(401);
    expect(people.error?.code).toBe("auth_required");
    const disabled = await identityEvents(database.db, "identity.user.disabled");
    expect(disabled).toHaveLength(1);
    expect(disabled[0]?.payload).toEqual({ userId: aliceId, actorId: chiefId });
    expect(disabled[0]?.trace_id).toBe(reply.requestId);

    const enabled = await call(app, PEOPLE.enable(aliceId), { method: "POST", cookie: chief });
    expect(enabled.status).toBe(200);
    expect((enabled.body as { account: { isDisabled: boolean } }).account.isDisabled).toBe(false);
    expect((await call(app, "/api/v1/auth/me", { cookie: alice })).status).toBe(401);
    expect((await loginAs(app, "alice", PASSWORD)).status).toBe(200);
    const enabledEvents = await identityEvents(database.db, "identity.user.enabled");
    expect(enabledEvents).toHaveLength(1);
    expect(enabledEvents[0]?.payload).toEqual({ userId: aliceId, actorId: chiefId });
  });

  it("停用不摘组：停用再启用，组里的成员关系原样在，组的成员事件一条都没发（G-17）", async () => {
    const { app, chief, aliceId } = await troupe();
    const group = await seedGroup(database.db, { name: "dev", memberIds: [aliceId] });
    await call(app, PEOPLE.disable(aliceId), { method: "POST", cookie: chief });
    await call(app, PEOPLE.enable(aliceId), { method: "POST", cookie: chief });

    const detail = await call(app, PEOPLE.group(group.id), { cookie: chief });
    expect((detail.body as { group: { memberIds: string[] } }).group.memberIds).toEqual([aliceId]);
    expect(await identityEvents(database.db, "identity.group.members.changed")).toEqual([]);
    expect(await identityEvents(database.db, "identity.group.created")).toEqual([]);
    // 停用、启用各发一条账号的事件，组的没有
    expect(await identityEvents(database.db, "identity.user.disabled")).toHaveLength(1);
    expect(await identityEvents(database.db, "identity.user.enabled")).toHaveLength(1);
  });

  it("再停用一个已停用的账号、再启用一个启用的：200，什么都不写、不发事件（实现定下：同「没变就不动」）", async () => {
    const { app, chief, aliceId } = await troupe();
    await call(app, PEOPLE.disable(aliceId), { method: "POST", cookie: chief });
    const before = (await identityEvents(database.db)).length;
    const again = await call(app, PEOPLE.disable(aliceId), { method: "POST", cookie: chief });
    expect(again.status).toBe(200);
    expect((await identityEvents(database.db)).length).toBe(before);
    await call(app, PEOPLE.enable(aliceId), { method: "POST", cookie: chief });
    const after = (await identityEvents(database.db)).length;
    const twice = await call(app, PEOPLE.enable(aliceId), { method: "POST", cookie: chief });
    expect(twice.status).toBe(200);
    expect((await identityEvents(database.db)).length).toBe(after);
  });
});

describe("护栏：留一个管理员（规格 G-18、G-20）", () => {
  // 只剩一个启用的管理员时，走得到路由的操作者只能是他自己，所以三个动作同时命中两道闸；
  // 数量那道闸先说（2026-11-28 实现定下，见 admin-accounts.ts 的注释）——identity_last_admin
  // 因此在集成测试里打得到（规格 G-04）。并发下两个管理员互相降级的交错在真 Postgres 上验（G-20）。
  it("只剩一个启用的管理员：降级、停用、删除各回 409 identity_last_admin，什么都没写（G-18）", async () => {
    const { app, chiefId, chief } = await troupe();
    // 另有一个管理员，但已停用：数「启用的」只有 chief 一个
    const spare = await seedUser(database.db, {
      username: "spare",
      password: PASSWORD,
      isAdmin: true,
    });
    await call(app, PEOPLE.disable(spare.id), { method: "POST", cookie: chief });

    const eventsBefore = (await identityEvents(database.db)).length;
    const demote = await call(app, PEOPLE.member(chiefId), {
      method: "PATCH",
      cookie: chief,
      body: { isAdmin: false },
    });
    expect(demote.status).toBe(409);
    expect(demote.error?.code).toBe("identity_last_admin");
    const disable = await call(app, PEOPLE.disable(chiefId), { method: "POST", cookie: chief });
    expect(disable.status).toBe(409);
    expect(disable.error?.code).toBe("identity_last_admin");
    const remove = await call(app, PEOPLE.member(chiefId), { method: "DELETE", cookie: chief });
    expect(remove.status).toBe(409);
    expect(remove.error?.code).toBe("identity_last_admin");
    expect((await userRows(database.db)).find((row) => row.id === chiefId)?.is_admin).toBe(true);
    expect((await identityEvents(database.db)).length).toBe(eventsBefore);
  });

  it("有两个启用的管理员：三个动作对其中任一个都得 200（G-18）", async () => {
    const { app, chief } = await troupe();
    const spare = await seedUser(database.db, {
      username: "spare",
      password: PASSWORD,
      isAdmin: true,
    });
    // 降级 spare：还有 chief 一个启用的管理员，动得
    const demote = await call(app, PEOPLE.member(spare.id), {
      method: "PATCH",
      cookie: chief,
      body: { isAdmin: false },
    });
    expect(demote.status).toBe(200);
    // 再来一个管理员，对它停用（动作之前有两个启用的）
    const spare2 = await seedUser(database.db, {
      username: "spare2",
      password: PASSWORD,
      isAdmin: true,
    });
    expect(
      (await call(app, PEOPLE.disable(spare2.id), { method: "POST", cookie: chief })).status,
    ).toBe(200);
    // spare2 停用了、不是管理员，删得掉（没建过工程）
    expect(
      (await call(app, PEOPLE.member(spare2.id), { method: "DELETE", cookie: chief })).status,
    ).toBe(200);
    expect((await userRows(database.db)).map((row) => row.username)).toEqual([
      "alice",
      "chief",
      "spare",
    ]);
  });

  it("先停用备用的（得 200，还剩一个），然后对剩下的那个降级，回 409（G-18 的第三种）", async () => {
    const { app, chief, chiefId } = await troupe();
    const spare = await seedUser(database.db, {
      username: "spare",
      password: PASSWORD,
      isAdmin: true,
    });
    expect(
      (await call(app, PEOPLE.disable(spare.id), { method: "POST", cookie: chief })).status,
    ).toBe(200);
    const demote = await call(app, PEOPLE.member(chiefId), {
      method: "PATCH",
      cookie: chief,
      body: { isAdmin: false },
    });
    expect(demote.status).toBe(409);
    expect(demote.error?.code).toBe("identity_last_admin");
    // 并发的场景在真 Postgres 上验（规格 G-20）：进程内的库一次只跑一个事务，这里盖串行的那半边
  });
});

describe("不动自己（规格 G-19）", () => {
  // 场景里有两个启用的管理员：数量那道闸不命中，「不动自己」的 409 才显出来（G-18 的单管理员场景见上一组）
  it("降级、停用、删除自己，或给自己重置口令：各回 409 identity_self_change，账号、会话、事件都没变", async () => {
    const { app, chiefId, chief } = await troupe();
    // 另一个启用的管理员在场：动自己不至于失去最后一个
    await seedUser(database.db, { username: "spare", password: PASSWORD, isAdmin: true });
    const eventsBefore = (await identityEvents(database.db)).length;
    const sessionsBefore = (await sessionRows(database.db)).length;

    const demote = await call(app, PEOPLE.member(chiefId), {
      method: "PATCH",
      cookie: chief,
      body: { isAdmin: false },
    });
    expect(demote.status).toBe(409);
    expect(demote.error?.code).toBe("identity_self_change");
    const disable = await call(app, PEOPLE.disable(chiefId), { method: "POST", cookie: chief });
    expect(disable.status).toBe(409);
    expect(disable.error?.code).toBe("identity_self_change");
    const remove = await call(app, PEOPLE.member(chiefId), { method: "DELETE", cookie: chief });
    expect(remove.status).toBe(409);
    expect(remove.error?.code).toBe("identity_self_change");
    const reset = await call(app, PEOPLE.password(chiefId), {
      method: "POST",
      cookie: chief,
      body: { newPassword: "brand-new-password" },
    });
    expect(reset.status).toBe(409);
    expect(reset.error?.code).toBe("identity_self_change");

    expect((await userRows(database.db)).find((row) => row.id === chiefId)?.is_admin).toBe(true);
    expect((await userRows(database.db)).find((row) => row.id === chiefId)?.disabled_at).toBeNull();
    expect((await sessionRows(database.db)).length).toBe(sessionsBefore);
    expect((await identityEvents(database.db)).length).toBe(eventsBefore);
    // 改自己的显示名不在四个动作里：改自己的显示名是允许的（规格 G-19 只拦降级）
    const rename = await call(app, PEOPLE.member(chiefId), {
      method: "PATCH",
      cookie: chief,
      body: { displayName: "头儿" },
    });
    expect(rename.status).toBe(200);
  });
});

describe("删号（规格 G-21 到 G-23）", () => {
  it("建过工程的不删：409 identity_user_has_projects，账号和工程都在；没建过的删得掉（G-21）", async () => {
    const { app, chief, aliceId } = await troupe();
    // 另一个管理员，没建过工程：操作者（chief）不是它，删得掉
    const spare = await seedUser(database.db, {
      username: "spare",
      password: PASSWORD,
      isAdmin: true,
    });
    // 直接种一条工程行：引用约束看的是行，不用真建仓库（人员规格「验收」引 P-16 的方式建也行）
    await seedProject(database.db, { slug: "alpha", createdById: aliceId });

    const reply = await call(app, PEOPLE.member(aliceId), { method: "DELETE", cookie: chief });
    expect(reply.status).toBe(409);
    expect(reply.error?.code).toBe("identity_user_has_projects");
    expect((await userRows(database.db)).some((row) => row.id === aliceId)).toBe(true);
    expect(await projectRows(database.db)).toHaveLength(1);
    expect(await identityEvents(database.db, "identity.user.deleted")).toEqual([]);
    // 没建过工程的管理员，删得掉
    expect(
      (await call(app, PEOPLE.member(spare.id), { method: "DELETE", cookie: chief })).status,
    ).toBe(200);
    expect((await userRows(database.db)).some((row) => row.id === spare.id)).toBe(false);
  });

  it("删号：账号行、会话行、成员关系行一起没，两个组的成员里都没有他，事件带删前的组（G-22）", async () => {
    const { app, chief, aliceId } = await troupe();
    const first = await loginAs(app, "alice", PASSWORD);
    const groupOne = await seedGroup(database.db, { name: "one", memberIds: [aliceId] });
    const groupTwo = await seedGroup(database.db, { name: "two", memberIds: [aliceId] });

    const reply = await call(app, PEOPLE.member(aliceId), { method: "DELETE", cookie: chief });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true });
    expect((await userRows(database.db)).some((row) => row.id === aliceId)).toBe(false);
    expect((await sessionRows(database.db)).some((row) => row.user_id === aliceId)).toBe(false);
    expect((await call(app, "/api/v1/auth/me", { cookie: first.cookie })).status).toBe(401);
    for (const group of [groupOne, groupTwo]) {
      const detail = await call(app, PEOPLE.group(group.id), { cookie: chief });
      expect((detail.body as { group: { memberIds: string[] } }).group.memberIds).toEqual([]);
    }
    const deleted = await identityEvents(database.db, "identity.user.deleted");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.subject).toBe("alice");
    expect(deleted[0]?.payload).toEqual({
      userId: aliceId,
      actorId: expect.any(String),
      // 删前他在哪些组里；次序不表示什么（规格「路由与总则」），仓储按编号给一个稳定的次序
      groupIds: [groupOne.id, groupTwo.id].sort(),
    });
    expect(deleted[0]?.trace_id).toBe(reply.requestId);
    // 删号的成员移除不发组的事件（规格 G-39）：组的事件一条都没有，账号的只有 deleted 一条
    expect(await identityEvents(database.db, "identity.group.members.changed")).toEqual([]);
    expect(await identityEvents(database.db, "identity.user.deleted")).toHaveLength(1);
    expect(await identityEvents(database.db, "identity.user.disabled")).toEqual([]);
    expect(await identityEvents(database.db, "identity.user.updated")).toEqual([]);
  });

  it("名字可重用：删掉乙再建一个同名的，201、编号不同、不在任何组里（G-23）", async () => {
    const { app, chief, aliceId } = await troupe();
    await seedGroup(database.db, { name: "dev", memberIds: [aliceId] });
    expect(
      (await call(app, PEOPLE.member(aliceId), { method: "DELETE", cookie: chief })).status,
    ).toBe(200);

    const again = await call(app, PEOPLE.users, {
      method: "POST",
      cookie: chief,
      body: { username: "alice", password: PASSWORD },
    });
    expect(again.status).toBe(201);
    const reborn = (again.body as { account: { id: string } }).account;
    expect(reborn.id).not.toBe(aliceId);
    const groups = await call(app, PEOPLE.groups, { cookie: chief });
    expect(
      (groups.body as { groups: Array<{ memberIds: string[] }> }).groups[0]?.memberIds,
    ).toEqual([]);
  });
});
