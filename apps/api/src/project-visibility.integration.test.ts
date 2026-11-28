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
} from "./testing/kit.ts";
import { PASSWORD, PEOPLE, clearGroups, groupRows, seedGroup } from "./testing/people.ts";
import {
  PROJECTS,
  clearProjects,
  create,
  createdId,
  projectRoots,
  type Roots,
} from "./testing/projects.ts";
import { stageFresh } from "./testing/troupe.ts";

/**
 * 判断点那一半（人员规格 G-32、G-33、G-35、G-34 的可见性半边，工程规格 P-12）：
 * 谁看得见、移出组立刻看不见、停用再启用恢复、组员改不动、认证结果带组。
 * 一个组的可见工程两条路由和建工程自动挂组在 group-visibility.integration.test.ts。
 */

let database: DatabaseHandle;
let roots: Roots;

beforeAll(async () => {
  database = await createTestDatabase();
  roots = projectRoots();
});

afterAll(async () => {
  await roots.removeAll();
  await database.close();
});

beforeEach(async () => {
  await clearProjects(database.db);
  await clearGroups(database.db);
  await clearIdentity(database.db);
});

describe("判断点（规格 G-32、G-33、P-12、G-35）", () => {
  it("P-12 的三个场景：同组的乙清单里有、详情 200；不同组的丙清单里没有、详情 404；管理员的清单里有（G-32）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    const alice = troupe.alice.id;
    // 乙进甲的组；丙不在任何组里
    await seedGroup(db, { name: "mine", memberIds: [alice, troupe.bob.id] });
    const created = await create(troupe.api.app, troupe.alice.cookie, { slug: "alpha" });
    const projectId = createdId(created);

    const bobList = await call(troupe.api.app, PROJECTS.list, { cookie: troupe.bob.cookie });
    expect((bobList.body as { projects: Array<{ id: string }> }).projects.map((p) => p.id)).toEqual(
      [projectId],
    );
    expect(
      (await call(troupe.api.app, PROJECTS.member(projectId), { cookie: troupe.bob.cookie }))
        .status,
    ).toBe(200);

    await seedUser(db, { username: "carol", password: PASSWORD });
    const carol = await loginAs(troupe.api.app, "carol", PASSWORD);
    expect((await call(troupe.api.app, PROJECTS.list, { cookie: carol.cookie })).body).toEqual({
      projects: [],
    });
    const carolDetail = await call(troupe.api.app, PROJECTS.member(projectId), {
      cookie: carol.cookie,
    });
    expect(carolDetail.status).toBe(404);
    expect(carolDetail.error?.code).toBe("not_found");

    const chiefList = await call(troupe.api.app, PROJECTS.list, { cookie: troupe.chief.cookie });
    expect(
      (chiefList.body as { projects: Array<{ id: string }> }).projects.map((p) => p.id),
    ).toEqual([projectId]);
  });

  it("把乙移出组，乙的清单里没有 P；停用乙再启用，乙的清单里又有 P（G-32、G-17、G-33）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    const alice = troupe.alice.id;
    const bobId = troupe.bob.id;
    const group = await seedGroup(db, { name: "mine", memberIds: [alice, bobId] });
    const created = await create(troupe.api.app, troupe.alice.cookie, { slug: "alpha" });
    const projectId = createdId(created);

    await call(troupe.api.app, PEOPLE.members(group.id), {
      method: "PUT",
      cookie: troupe.chief.cookie,
      body: { userIds: [alice] },
    });
    expect((await call(troupe.api.app, PROJECTS.list, { cookie: troupe.bob.cookie })).body).toEqual(
      {
        projects: [],
      },
    );
    // 组变了下一个请求就生效（规格 G-34）：乙的下一个详情 404
    expect(
      (await call(troupe.api.app, PROJECTS.member(projectId), { cookie: troupe.bob.cookie }))
        .status,
    ).toBe(404);

    // 移回来，停用再启用：停用不摘组，看得见的工程原样回来（规格 G-17）
    await call(troupe.api.app, PEOPLE.members(group.id), {
      method: "PUT",
      cookie: troupe.chief.cookie,
      body: { userIds: [alice, bobId] },
    });
    await call(troupe.api.app, PEOPLE.disable(bobId), {
      method: "POST",
      cookie: troupe.chief.cookie,
    });
    await call(troupe.api.app, PEOPLE.enable(bobId), {
      method: "POST",
      cookie: troupe.chief.cookie,
    });
    const fresh = await loginAs(troupe.api.app, "bob", PASSWORD);
    const list = await call(troupe.api.app, PROJECTS.list, { cookie: fresh.cookie });
    expect((list.body as { projects: Array<{ id: string }> }).projects.map((p) => p.id)).toEqual([
      projectId,
    ]);
  });

  it("同组的乙改甲的工程：403 projects_forbidden；组的成员不因此能改（G-35）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    const alice = troupe.alice.id;
    await seedGroup(db, { name: "mine", memberIds: [alice, troupe.bob.id] });
    const created = await create(troupe.api.app, troupe.alice.cookie, { slug: "alpha" });
    const projectId = createdId(created);

    const reply = await call(troupe.api.app, PROJECTS.member(projectId), {
      method: "PATCH",
      cookie: troupe.bob.cookie,
      body: { displayName: "乙改的" },
    });
    expect(reply.status).toBe(403);
    expect(reply.error?.code).toBe("projects_forbidden");
  });

  it("空组不碍事：只靠创建者身份看得见（G-34 的「不在任何组不变」补一条清单）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    await seedGroup(db, { name: "empty" });
    const created = await create(troupe.api.app, troupe.alice.cookie, { slug: "alpha" });
    const projectId = createdId(created);
    const list = await call(troupe.api.app, PROJECTS.list, { cookie: troupe.alice.cookie });
    expect((list.body as { projects: Array<{ id: string }> }).projects.map((p) => p.id)).toEqual([
      projectId,
    ]);
    expect(await groupRows(db)).toHaveLength(1);
    expect(await identityEvents(db, "identity.group.created")).toEqual([]);
  });
});

/** 集成测试里认证结果的组从哪来：装一个应用、把管理员放进组，直接看认证器交回来的东西。 */
describe("认证结果带组（规格 G-34）", () => {
  it("authenticate 交回来的东西里有 groupIds；不在任何组就是空数组；组变了下一个请求生效", async () => {
    const db = database.db;
    const api = await boot({ db });
    const alice = await seedUser(db, { username: "alice", password: PASSWORD });
    await seedUser(db, { username: "chief", password: PASSWORD, isAdmin: true });
    const group = await seedGroup(db, { name: "dev", memberIds: [alice.id] });
    const login = await loginAs(api.app, "alice", PASSWORD);
    const token = login.cookie.split("=")[1] ?? "";
    const session = await api.identity.service.authenticate(token);
    expect(session?.groupIds).toEqual([group.id]);

    // 移出组：下一个认证就是空数组
    await call(api.app, PEOPLE.members(group.id), {
      method: "PUT",
      cookie: (await loginAs(api.app, "chief", PASSWORD)).cookie,
      body: { userIds: [] },
    });
    const next = await api.identity.service.authenticate(token);
    expect(next?.groupIds).toEqual([]);
  });
});
