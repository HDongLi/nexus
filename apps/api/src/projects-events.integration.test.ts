import type { DatabaseHandle } from "@nexus/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, createTestDatabase, type Reply } from "./testing/kit.ts";
import {
  PROJECTS,
  clearProjects,
  createdId,
  create,
  leaksPath,
  pgDetail,
  projectRoots,
  projectRows,
  projectsEvents,
  seedProject,
  signIn,
  stage,
  type Roots,
} from "./testing/projects.ts";

/**
 * 两个事件的信封和内容（规格 P-34、P-35），以及记录对账号的引用约束（设计 02）。
 * 事件只能从真路由打出来，所以前两条用例各建一个真的工程；引用约束是库的事，记录直接种进表里。
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
});

describe("两个事件", () => {
  it("建一个、改两次：每条事件的类型、source、subject、payload 的键集合、traceId 逐条照表（P-34）", async () => {
    const { api, alice } = await stage(database.db, await roots.fresh());
    const id = createdId(
      await create(
        api.app,
        alice.cookie,
        { slug: "alpha", displayName: "甲", avatar: "A" },
        "trace-1",
      ),
    );
    const patch = (body: Record<string, unknown>, requestId: string): Promise<Reply> =>
      call(api.app, PROJECTS.member(id), {
        method: "PATCH",
        cookie: alice.cookie,
        body,
        requestId,
      });
    expect((await patch({ displayName: "乙" }, "trace-2")).status).toBe(200);
    expect((await patch({ avatar: "B" }, "trace-3")).status).toBe(200);

    const events = await projectsEvents(database.db);
    expect(
      events.map((event) => [
        event.type,
        event.source,
        event.subject,
        Object.keys(event.payload).sort(),
        event.trace_id,
      ]),
    ).toEqual([
      ["projects.project.created", "projects", id, ["actorId", "projectId", "slug"], "trace-1"],
      [
        "projects.project.updated",
        "projects",
        id,
        ["actorId", "changes", "projectId", "slug"],
        "trace-2",
      ],
      [
        "projects.project.updated",
        "projects",
        id,
        ["actorId", "changes", "projectId", "slug"],
        "trace-3",
      ],
    ]);
    // 主体是工程，操作者在 payload 里
    expect(events[0]?.payload).toEqual({ projectId: id, slug: "alpha", actorId: alice.user.id });
    expect(events[1]?.payload).toEqual({
      projectId: id,
      slug: "alpha",
      actorId: alice.user.id,
      changes: { displayName: { from: "甲", to: "乙" } },
    });
    expect(events[2]?.payload).toEqual({
      projectId: id,
      slug: "alpha",
      actorId: alice.user.id,
      changes: { avatar: { from: "A", to: "B" } },
    });
  });

  it("两个事件的 subject 和 payload 里都不出现服务器路径：事件序列化后不含 PROJECTS_ROOT 的值（P-35）", async () => {
    const root = await roots.fresh();
    const { api, alice } = await stage(database.db, root);
    const id = createdId(await create(api.app, alice.cookie, { slug: "alpha" }, "trace-1"));
    const patched = await call(api.app, PROJECTS.member(id), {
      method: "PATCH",
      cookie: alice.cookie,
      body: { displayName: "乙" },
      requestId: "trace-2",
    });
    expect(patched.status).toBe(200);

    const events = await projectsEvents(database.db);
    expect(events.map((event) => event.type)).toEqual([
      "projects.project.created",
      "projects.project.updated",
    ]);
    // 对照组：根目录确实是个非空的路径，查的不是空串
    expect(root.length).toBeGreaterThan(10);
    expect(leaksPath(JSON.stringify(events), root)).toBe(false);
  });
});

describe("记录对账号的引用约束（设计 02「和身份模块的关系」）", () => {
  it("绕过接口删一个建过工程的账号，库拒绝；删掉工程之后账号才删得掉", async () => {
    const { api } = await stage(database.db, await roots.fresh());
    // 用一个专门的账号：别把后面用例还要用的登录删掉
    const maker = await signIn(database.db, api.app, "maker");
    const id = (await seedProject(database.db, { slug: "alpha", createdById: maker.user.id })).id;
    const removeMaker = () =>
      database.db.execute(sql`delete from identity_users where id = ${maker.user.id}`);

    // 拦下它的正是这条引用约束。错误码进程内的库（新版 Postgres）报 23001，老版本报 23503，两种都认
    const refused: unknown = await removeMaker().catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(Error);
    expect(pgDetail(refused)).toMatchObject({
      constraint: "projects_created_by_id_identity_users_id_fk",
    });
    expect(["23001", "23503"]).toContain(pgDetail(refused).code);
    expect((await projectRows(database.db)).map((row) => row.id)).toEqual([id]);

    await database.db.execute(sql`delete from projects where id = ${id}`);
    await removeMaker();
    // 账号真的没了：再建一个同名的是另一个编号
    const again = await signIn(database.db, api.app, "maker");
    expect(again.user.id).not.toBe(maker.user.id);
  });
});
