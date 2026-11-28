import type { DatabaseHandle } from "@nexus/db";
import { createGitRunner } from "@nexus/projects";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, createTestDatabase } from "./testing/kit.ts";
import {
  clearProjects,
  countingGit,
  createdId,
  create,
  eventuallyDead,
  failingGit,
  git,
  leaksPath,
  PROJECTS,
  projectRoots,
  restage,
  stage,
  type Roots,
} from "./testing/projects.ts";

/** 详情这条竖切：`head` 从真的裸仓库里读出来，只跑一次 git；读不到就 500。 */

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
  // 每个用例从没有工程的库开始；账号和登录整个文件只用一回，由 stage 记住。
  await clearProjects(database.db);
});

const PROJECT_KEYS = [
  "id",
  "slug",
  "displayName",
  "avatar",
  "createdById",
  "createdAt",
  "updatedAt",
];

describe("详情（规格 P-25、P-26）", () => {
  it("新建后读详情：七个键加 head；编号等于仓库的 HEAD，提交时间对得上，标题是初始提交说明的第一行；git 恰好调用 1 次（P-25）", async () => {
    const counter = countingGit();
    const root = await roots.fresh();
    const { api, alice } = await stage(database.db, root, { git: counter });
    const created = await create(api.app, alice.cookie, { slug: "alpha", displayName: "甲的工程" });
    const id = createdId(created);
    const callsAfterCreate = counter.count();

    const reply = await call(api.app, PROJECTS.member(id), { cookie: alice.cookie });
    expect(reply.status).toBe(200);
    expect(Object.keys(reply.body as object)).toEqual(["project"]);
    const project = (reply.body as { project: Record<string, unknown> }).project;
    expect(Object.keys(project)).toEqual([...PROJECT_KEYS, "head"]);
    // 记录的那七个键和新建回的一字不差
    for (const key of PROJECT_KEYS)
      expect(project[key], key).toEqual(
        (created.body as { project: Record<string, unknown> }).project[key],
      );

    const bare = join(root, `${id}.git`);
    expect(project.head).toEqual({
      commitId: (await git(["--git-dir", bare, "rev-parse", "HEAD"])).trim(),
      committedAt: new Date(
        (await git(["--git-dir", bare, "log", "-1", "--format=%cI"])).trim(),
      ).toISOString(),
      subject: "Initial commit",
    });
    expect(counter.count() - callsAfterCreate).toBe(1);
  });

  it("git 失败：详情回 500 internal_error，带请求号，不回 head 为空的详情；日志里有同一请求号的报错行（P-05、P-26）", async () => {
    const root = await roots.fresh();
    const good = await stage(database.db, root);
    const id = createdId(await create(good.api.app, good.alice.cookie, { slug: "alpha" }));

    const broken = await restage(database.db, root, good, { git: failingGit(1) });
    const reply = await call(broken.api.app, PROJECTS.member(id), {
      cookie: broken.alice.cookie,
      requestId: "trace-head",
    });
    expect(reply.status).toBe(500);
    expect(reply.error).toMatchObject({ code: "internal_error", requestId: "trace-head" });
    expect(reply.error?.code).not.toBe("projects_creation_failed");
    expect(reply.body).not.toHaveProperty("project");
    expect(leaksPath(JSON.stringify(reply.body), root)).toBe(false);

    const logged = broken.api.log
      .entries()
      .find((entry) => entry.requestId === "trace-head" && entry.msg === "请求处理失败");
    expect(logged).toBeDefined();
  });

  it("git 一直挂着：到点结束它，详情回 500 internal_error，桩进程已结束（P-26）", async () => {
    const root = await roots.fresh();
    const good = await stage(database.db, root);
    const id = createdId(await create(good.api.app, good.alice.cookie, { slug: "alpha" }));

    let killed: number | undefined;
    const hanging = createGitRunner({
      executable: process.execPath,
      preArgs: ["-e", "setTimeout(() => {}, 60000)", "--"],
      timeoutMs: 200,
      onTimeout: (info) => {
        killed = info.pid;
      },
    });
    const slow = await restage(database.db, root, good, { git: hanging });
    const started = performance.now();
    const reply = await call(slow.api.app, PROJECTS.member(id), { cookie: slow.alice.cookie });
    expect(reply.status).toBe(500);
    expect(reply.error?.code).toBe("internal_error");
    expect(performance.now() - started).toBeLessThan(1000);
    expect(killed).toBeTypeOf("number");
    await eventuallyDead(killed as number);
  });
});
