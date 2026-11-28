import type { DatabaseHandle } from "@nexus/db";
import { sql } from "drizzle-orm";
import { createProjectsRepo } from "@nexus/projects";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, clearIdentity, createTestDatabase } from "./testing/kit.ts";
import { PEOPLE, clearGroups, groupRows, seedGroup } from "./testing/people.ts";
import {
  clearProjects,
  create,
  createdId,
  projectGroupRows,
  projectRoots,
  projectsEvents,
  seedProject,
  type Roots,
} from "./testing/projects.ts";
import { restageFresh, stageFresh } from "./testing/troupe.ts";

/**
 * 用户组接进工程的可见性（人员规格 G-31 到 G-35，工程规格 P-12）：
 * 一个组的可见工程两条路由、建工程自动挂组、判断点、移出组立刻看不见、
 * visibility.changed 事件、同事务回滚。建仓要跑真的 git，走 stage/restage 的装配。
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

const MISSING_GROUP = "20000000-0000-4000-8000-0000000000ff";
const MISSING_PROJECT = "30000000-0000-4000-8000-0000000000ff";

const groupProjects = (id: string): string => `/api/v1/groups/${id}/projects`;

describe("一个组的可见工程（规格 G-31、G-27、G-28）", () => {
  it("读；组不存在 404；「组在不在」换成恒假的桩，读也 404（G-31）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    const group = await seedGroup(db, { name: "dev", memberIds: [troupe.alice.id] });
    const project = await seedProject(db, { slug: "alpha", createdById: troupe.alice.id });
    // 直接种关系行：读的那一半只看表
    await db.execute(
      sql`insert into project_groups (project_id, group_id) values (${project.id}, ${group.id})`,
    );

    const ok = await call(troupe.api.app, groupProjects(group.id), { cookie: troupe.chief.cookie });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ projectIds: [project.id] });

    const missing = await call(troupe.api.app, groupProjects(MISSING_GROUP), {
      cookie: troupe.chief.cookie,
    });
    expect(missing.status).toBe(404);
    expect(missing.error?.code).toBe("not_found");

    // 「组在不在」换成恒假的桩：读得 404（规格 G-31 的验收）
    const blind = await restageFresh(troupe, db, { groupExists: async () => false });
    expect(
      (await call(blind.api.app, groupProjects(group.id), { cookie: troupe.chief.cookie })).status,
    ).toBe(404);
  });

  it("整体替换：变了发事件（cause: admin）；顺序换了集合没变不写不发；换成空集；工程编号不存在 400（G-28、G-27）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    const group = await seedGroup(db, { name: "dev" });
    const alice = troupe.alice.id;
    const first = await seedProject(db, { slug: "alpha", createdById: alice });
    const second = await seedProject(db, { slug: "beta", createdById: alice });

    const put = (ids: string[]): ReturnType<typeof call> =>
      call(troupe.api.app, groupProjects(group.id), {
        method: "PUT",
        cookie: troupe.chief.cookie,
        body: { projectIds: ids },
      });

    const replace = await put([first.id, second.id]);
    expect(replace.status).toBe(200);
    expect(replace.body).toEqual({ projectIds: [first.id, second.id] });
    expect(await projectGroupRows(db)).toHaveLength(2);
    let events = await projectsEvents(db, "projects.visibility.changed");
    expect(events).toHaveLength(1);
    expect(events[0]?.subject).toBe(group.id);
    expect(events[0]?.payload).toEqual({
      groupId: group.id,
      actorId: troupe.chief.id,
      changes: { projectIds: { from: [], to: [first.id, second.id] } },
      cause: "admin",
    });
    expect(events[0]?.trace_id).toBe(replace.requestId);

    // 顺序不同、集合一样：200，不写不发（规格 G-28）
    const swap = await put([second.id, first.id]);
    expect(swap.status).toBe(200);
    expect(await projectsEvents(db, "projects.visibility.changed")).toHaveLength(1);
    expect(await projectGroupRows(db)).toHaveLength(2);

    // 换成空集
    const empty = await put([]);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ projectIds: [] });
    expect(await projectGroupRows(db)).toEqual([]);
    events = await projectsEvents(db, "projects.visibility.changed");
    expect(events).toHaveLength(2);
    expect(events[1]?.payload).toEqual({
      groupId: group.id,
      actorId: troupe.chief.id,
      // from 是存下来的次序（仓储按编号排，次序稳定，规格「路由与总则」：顺序不表示什么）
      changes: { projectIds: { from: [first.id, second.id].sort(), to: [] } },
      cause: "admin",
    });

    // 工程编号不存在：400，组和关系都没变（规格 G-27）
    const unknown = await put([MISSING_PROJECT]);
    expect(unknown.status).toBe(400);
    expect(unknown.error?.code).toBe("invalid_request");
    expect(await projectGroupRows(db)).toEqual([]);
  });

  it("组不在时整体替换：404，什么都不写；同一个在的组，桩换成恒假就 404、恒真就 200（规格 G-31 的验收）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    const project = await seedProject(db, { slug: "alpha", createdById: troupe.alice.id });
    const group = await seedGroup(db, { name: "dev" });

    // 组真的不在：404（缺省接线问的是身份模块）
    const reply = await call(troupe.api.app, groupProjects(MISSING_GROUP), {
      method: "PUT",
      cookie: troupe.chief.cookie,
      body: { projectIds: [project.id] },
    });
    expect(reply.status).toBe(404);
    expect(reply.error?.code).toBe("not_found");
    expect(await projectGroupRows(db)).toEqual([]);

    // 组在，但把「组在不在」的查询换成恒假的桩：读和整体替换都得 404（G-31）
    const blind = await restageFresh(troupe, db, { groupExists: async () => false });
    const blocked = await call(blind.api.app, groupProjects(group.id), {
      method: "PUT",
      cookie: troupe.chief.cookie,
      body: { projectIds: [project.id] },
    });
    expect(blocked.status).toBe(404);

    // 换成恒真的桩：200（G-31）
    const truthy = await restageFresh(troupe, db, { groupExists: async () => true });
    const passes = await call(truthy.api.app, groupProjects(group.id), {
      method: "PUT",
      cookie: troupe.chief.cookie,
      body: { projectIds: [project.id] },
    });
    expect(passes.status).toBe(200);
    expect(await projectGroupRows(db)).toHaveLength(1);
  });
});

describe("建工程自动挂组（规格 G-34）", () => {
  it("甲在两个组里：建完立刻读，两个组的可见工程都多了它；每个组一条自己的事件（G-34）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    const alice = troupe.alice.id;
    const one = await seedGroup(db, { name: "one", memberIds: [alice] });
    const two = await seedGroup(db, { name: "two", memberIds: [alice] });

    const created = await create(troupe.api.app, troupe.alice.cookie, { slug: "alpha" });
    const projectId = createdId(created);

    for (const group of [one, two]) {
      const reply = await call(troupe.api.app, groupProjects(group.id), {
        cookie: troupe.chief.cookie,
      });
      expect(reply.body).toEqual({ projectIds: [projectId] });
    }
    const events = await projectsEvents(db, "projects.visibility.changed");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.subject).sort()).toEqual([one.id, two.id].sort());
    for (const event of events) {
      expect(event.payload).toEqual({
        groupId: expect.any(String),
        actorId: alice,
        changes: { projectIds: { from: [], to: [projectId] } },
        cause: "project_created",
      });
      expect(event.trace_id).toBe(created.requestId);
    }
  });

  it("甲不在任何组里：建工程后没有组变（G-34）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    const created = await create(troupe.api.app, troupe.alice.cookie, { slug: "alpha" });
    expect(created.status).toBe(201);
    expect(await projectGroupRows(db)).toEqual([]);
    expect(await projectsEvents(db, "projects.visibility.changed")).toEqual([]);
  });

  it("建仓失败（记录写进去之后抛）：组不变，没有新事件（G-34、G-38、P-20）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    const group = await seedGroup(db, { name: "one", memberIds: [troupe.alice.id] });
    // 记录写进去之后抛（真仓储包一层）：挂组和两件事务里的事件跟着一起回滚（规格 G-38）
    const real = createProjectsRepo();
    const exploding = await restageFresh(troupe, db, {
      repo: {
        ...real,
        insert: async (...args: Parameters<typeof real.insert>) => {
          const inserted = await real.insert(...args);
          throw new Error(`写入之后磁盘满了：${inserted.id}`);
        },
      },
    });
    const reply = await create(exploding.api.app, troupe.alice.cookie, { slug: "alpha" });
    expect(reply.status).toBe(500);
    expect(reply.error?.code).toBe("projects_creation_failed");
    expect(await projectGroupRows(db)).toEqual([]);
    expect(await projectsEvents(db)).toEqual([]);
    expect(await groupRows(db)).toHaveLength(1);
    expect(group).toBeDefined();
  });

  it("甲建完工程后被移出组：那个组看得见的工程不变（G-34）", async () => {
    const db = database.db;
    const troupe = await stageFresh(db, () => roots.fresh());
    const alice = troupe.alice.id;
    const group = await seedGroup(db, { name: "one", memberIds: [alice] });
    const created = await create(troupe.api.app, troupe.alice.cookie, { slug: "alpha" });
    const projectId = createdId(created);

    await call(troupe.api.app, PEOPLE.members(group.id), {
      method: "PUT",
      cookie: troupe.chief.cookie,
      body: { userIds: [] },
    });
    const reply = await call(troupe.api.app, groupProjects(group.id), {
      cookie: troupe.chief.cookie,
    });
    expect(reply.body).toEqual({ projectIds: [projectId] });
  });
});
