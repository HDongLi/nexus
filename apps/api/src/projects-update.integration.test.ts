import type { DatabaseHandle } from "@nexus/db";
import { createProjectsRepo, type ProjectRepo } from "@nexus/projects";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, createTestDatabase, T0, type Reply } from "./testing/kit.ts";
import {
  PROJECTS,
  clearProjects,
  projectRoots,
  projectRows,
  projectsEvents,
  restage,
  seedProject,
  stage,
  type Roots,
  type Session,
  type Troupe,
} from "./testing/projects.ts";

/**
 * 改显示名和头像字这条竖切（规格 P-27 到 P-33）。改不碰仓库，所以记录直接种进表里，整个文件一条 git 都不跑。
 * 账号和登录整个文件只用一回，每个用例动手前只清工程。
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

const SECOND = 1000;

function patch(
  app: Troupe["api"]["app"],
  session: Session,
  id: string,
  body: Record<string, unknown>,
): Promise<Reply> {
  return call(app, PROJECTS.member(id), { method: "PATCH", cookie: session.cookie, body });
}

const stored = async (id: string) => (await projectRows(database.db)).find((row) => row.id === id);

/** 装好应用，给甲种一个显示名「甲」、头像字「A」的工程。 */
async function withProject(options: Parameters<typeof stage>[2] = {}) {
  const troupe = await stage(database.db, await roots.fresh(), options);
  const project = await seedProject(database.db, {
    slug: "alpha",
    displayName: "甲",
    avatar: "A",
    createdById: troupe.alice.user.id,
  });
  return { ...troupe, id: project.id };
}

describe("改显示名和头像字", () => {
  it("谁能改：看得见的旁人 403 projects_forbidden，创建者 200，管理员 200（P-29）", async () => {
    const { api, id, bob, alice, chief } = await withProject({
      canSee: () => ({ kind: "all" as const }),
    });

    const bystander = await patch(api.app, bob, id, { displayName: "乙改的" });
    expect(bystander.status).toBe(403);
    expect(bystander.error).toMatchObject({
      code: "projects_forbidden",
      requestId: bystander.requestId,
    });
    // 和别的失败一个形状：code、message、requestId，没有别的
    expect(Object.keys(bystander.error ?? {}).sort()).toEqual(["code", "message", "requestId"]);
    expect((await stored(id))?.display_name).toBe("甲");

    const byOwner = await patch(api.app, alice, id, { displayName: "甲改的" });
    expect(byOwner.status).toBe(200);
    expect((byOwner.body as { project: { displayName: string } }).project.displayName).toBe(
      "甲改的",
    );
    const byAdmin = await patch(api.app, chief, id, { avatar: "管" });
    expect(byAdmin.status).toBe(200);
    expect(await stored(id)).toMatchObject({ display_name: "甲改的", avatar: "管" });
  });

  it("规则在接口上同样生效：41 个字符、三个字的头像字回 400，什么都不改；首尾空白去掉后存（P-27、P-28）", async () => {
    const { api, id, alice } = await withProject();
    for (const body of [
      { displayName: "有".repeat(41) },
      { avatar: "三个字" },
      { avatar: "A B" },
    ]) {
      expect((await patch(api.app, alice, id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await stored(id)).toMatchObject({ display_name: "甲", avatar: "A", updated_at: T0 });
    expect(
      (await patch(api.app, alice, id, { displayName: "  新名字  ", avatar: " 字 " })).status,
    ).toBe(200);
    expect(await stored(id)).toMatchObject({ display_name: "新名字", avatar: "字" });
  });

  it("空串就是清除：改成空串后读表是空串（P-30）", async () => {
    const { api, id, alice } = await withProject();
    const reply = await patch(api.app, alice, id, { displayName: "", avatar: "" });
    expect(reply.status).toBe(200);
    expect(
      (reply.body as { project: { displayName: string; avatar: string } }).project,
    ).toMatchObject({
      displayName: "",
      avatar: "",
    });
    expect(await stored(id)).toMatchObject({ display_name: "", avatar: "" });
  });

  it("没变就不动：原值重发一次（首尾多带空白也算一样），updatedAt 不变，事件数不变（P-31）", async () => {
    const { api, id, alice } = await withProject();
    // 先真的改一次，让事件表里有一条 updated，比「事件数不变」才有内容
    await patch(api.app, alice, id, { displayName: "乙" });
    const eventsBefore = (await projectsEvents(database.db)).length;
    api.clock.tick(5 * SECOND);

    const reply = await patch(api.app, alice, id, { displayName: " 乙 ", avatar: "A" });
    expect(reply.status).toBe(200);
    expect((reply.body as { project: { updatedAt: string } }).project.updatedAt).toBe(
      T0.toISOString(),
    );
    expect((await stored(id))?.updated_at).toEqual(T0);
    expect(await projectsEvents(database.db)).toHaveLength(eventsBefore);
  });

  it("带 slug 回 400 invalid_request，短名不变（P-32）", async () => {
    const { api, id, alice } = await withProject();
    const reply = await patch(api.app, alice, id, { slug: "renamed", displayName: "甲" });
    expect(reply.status).toBe(400);
    expect(reply.error?.code).toBe("invalid_request");
    expect(await stored(id)).toMatchObject({ slug: "alpha", display_name: "甲" });
  });

  it("真的变了：更新时间挪了，发一条 updated 事件，traceId 等于请求号，changes 只列变了的键（P-33）", async () => {
    const { api, id, alice } = await withProject();
    api.clock.tick(SECOND);
    const reply = await patch(api.app, alice, id, { displayName: "新名字" });
    expect(reply.body).toMatchObject({
      project: {
        id,
        slug: "alpha",
        displayName: "新名字",
        avatar: "A",
        createdById: alice.user.id,
        createdAt: T0.toISOString(),
        updatedAt: new Date(T0.getTime() + SECOND).toISOString(),
      },
    });
    expect(Object.keys(reply.body as object)).toEqual(["project"]);
    expect((await stored(id))?.updated_at).toEqual(new Date(T0.getTime() + SECOND));
    // 记录是种进去的，没有「建成」事件：表里只有这一条
    expect(await projectsEvents(database.db)).toEqual([
      {
        type: "projects.project.updated",
        source: "projects",
        subject: id,
        payload: {
          projectId: id,
          slug: "alpha",
          actorId: alice.user.id,
          changes: { displayName: { from: "甲", to: "新名字" } },
        },
        trace_id: reply.requestId,
      },
    ]);
  });

  it("事件和写入同一个事务：写入之后抛错，回滚后事件表没有新行，记录也没变（P-33）", async () => {
    const good = await withProject();
    // 先真的改一次，让事件表里有一条；回滚后应当还是这一条
    await patch(good.api.app, good.alice, good.id, { displayName: "乙" });
    // 真仓储外面套一层：改完就抛
    const real = createProjectsRepo();
    const blowing: ProjectRepo = {
      ...real,
      updateProfile: async (ex, projectId, profile, at) => {
        await real.updateProfile(ex, projectId, profile, at);
        throw new Error("写入之后磁盘满了");
      },
    };
    const again = await restage(database.db, good.root, good, { repo: blowing });

    const reply = await patch(again.api.app, again.alice, good.id, { displayName: "改不动" });
    expect(reply.status).toBe(500);
    expect(reply.error).toMatchObject({ code: "internal_error", requestId: reply.requestId });
    expect(await stored(good.id)).toMatchObject({ display_name: "乙", updated_at: T0 });
    expect((await projectsEvents(database.db)).map((event) => event.type)).toEqual([
      "projects.project.updated",
    ]);
  });
});
