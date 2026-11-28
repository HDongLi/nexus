import type { DatabaseHandle } from "@nexus/db";
import { createGitRunner, createProjectsRepo, type ProjectRepo } from "@nexus/projects";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestApp } from "./testing/kit.ts";
import {
  HEAVY,
  clearProjects,
  createdId,
  create,
  eventuallyDead,
  failingGit,
  leaksPath,
  listing,
  pgDetail,
  projectRoots,
  projectRows,
  projectsEvents,
  restage,
  seedProject,
  snapshot,
  stage,
  type Roots,
} from "./testing/projects.ts";
/**
 * 新建失败的时候：每一步、超时、记录写不进库、同时同名。规格 P-20 的验收是「目录清单、记录数、事件数与新建前相同」，
 * 所以每个场景先放一个现成的工程，记下那三项，再让新建失败。
 * 现成的工程直接种进表里、配一个空目录，不建真仓库：这几个用例要看的只是「失败的那次没留痕」。
 * 「每一步失败」和「耗时」两条本身就要起十几回真进程，单独跑也超过默认的 5 秒，超时放宽到 HEAVY。
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

// 每个用例从没有工程的库开始；账号和登录整个文件只用一回，由 stage 记住。
beforeEach(async () => {
  await clearProjects(database.db);
});

/** 让一个应用的新建失败，再核现场、日志、正文。 */
async function expectWipedOut(
  staged: TestApp,
  cookie: string,
  root: string,
  slug: string,
  requestId: string,
  before: unknown,
  step: string,
): Promise<void> {
  const reply = await create(staged.app, cookie, { slug }, requestId);
  expect(reply.status, step).toBe(500);
  expect(reply.error, step).toMatchObject({ code: "projects_creation_failed", requestId });
  expect(await snapshot(database.db, root), step).toEqual(before);
  // 日志里有同一请求号的报错行；给人的那句话里没有路径（P-05）
  const failure = staged.log
    .entries()
    .filter((entry) => entry.requestId === requestId && entry.msg === "工程没建成");
  expect(failure, step).toHaveLength(1);
  expect(leaksPath(JSON.stringify(reply.body), root), step).toBe(false);
}

describe("新建失败不留痕（规格 P-05、P-20、P-22）", () => {
  it(
    "建仓的任何一步 git 失败：500 projects_creation_failed，三项与新建前相同；原因连同请求号进日志",
    async () => {
      const root = await roots.fresh();
      const troupe = await stage(database.db, root);
      await seedProject(database.db, { slug: "existing", createdById: troupe.alice.user.id }, root);
      const before = await snapshot(database.db, root);
      expect(before.dirs).toHaveLength(1);

      // 四条命令：init、add、commit、clone。哪一条失败都一样收场
      for (let step = 1; step <= 4; step++) {
        const label = `第 ${String(step)} 步`;
        const stub = failingGit(step);
        const broken = await restage(database.db, root, troupe, { git: stub });
        const requestId = `trace-fail-${String(step)}`;
        await expectWipedOut(
          broken.api,
          broken.alice.cookie,
          root,
          "doomed",
          requestId,
          before,
          label,
        );
        expect(stub.calls, label).toHaveLength(step);

        // 日志里带着底下那一步是哪条命令
        const failure = broken.api.log.entries().find((entry) => entry.requestId === requestId);
        expect(failure, label).toMatchObject({ step: "建仓库" });
        const err = failure?.err as { message: string };
        expect(err.message, label).toContain(`git ${stub.calls[step - 1]?.[0] ?? "?"} `);
      }
    },
    HEAVY,
  );

  it("一直挂着的 git：200 毫秒超时，请求 1 秒内回 500 projects_creation_failed，桩进程已结束，三项不变", async () => {
    const root = await roots.fresh();
    const good = await stage(database.db, root);
    await seedProject(database.db, { slug: "existing", createdById: good.alice.user.id }, root);
    const before = await snapshot(database.db, root);
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
    const reply = await create(slow.api.app, slow.alice.cookie, { slug: "doomed" }, "trace-hang");
    const elapsed = performance.now() - started;

    expect(reply.status).toBe(500);
    expect(reply.error).toMatchObject({
      code: "projects_creation_failed",
      requestId: "trace-hang",
    });
    expect(elapsed).toBeLessThan(1000);
    expect(killed).toBeTypeOf("number");
    await eventuallyDead(killed as number);
    expect(await snapshot(database.db, root)).toEqual(before);
    const failure = slow.api.log.entries().find((entry) => entry.requestId === "trace-hang");
    if (!failure) throw new Error("日志里没有这次失败的报错行");
    expect(failure.msg).toBe("工程没建成");
    // 记下的原因是「超时」，不是别的
    expect((failure.err as { timedOut: boolean }).timedOut).toBe(true);
  });

  it("记录写不进库：回滚，刚建的仓库也删掉；不留记录、不留事件（P-06、P-24）", async () => {
    const root = await roots.fresh();
    const good = await stage(database.db, root);
    await seedProject(database.db, { slug: "existing", createdById: good.alice.user.id }, root);
    const before = await snapshot(database.db, root);
    // 真仓储外面套一层：记录写进去之后故意抛错
    const real = createProjectsRepo();
    const blowing: ProjectRepo = {
      ...real,
      insert: async (ex, row) => {
        await real.insert(ex, row);
        throw new Error("写入之后磁盘满了");
      },
    };
    const exploding = await restage(database.db, root, good, { repo: blowing });

    await expectWipedOut(
      exploding.api,
      exploding.alice.cookie,
      root,
      "doomed",
      "trace-disk",
      before,
      "写记录",
    );
    const failure = exploding.api.log.entries().find((entry) => entry.requestId === "trace-disk");
    expect(failure).toMatchObject({ step: "写记录" });
  });
});

describe("同时同名（规格 P-21）", () => {
  it("并发发两个同短名请求：一个 201、一个 409 projects_slug_taken，只多一个仓库目录、一条记录、一条事件", async () => {
    const root = await roots.fresh();
    const { api, alice } = await stage(database.db, root);
    const [first, second] = await Promise.all([
      create(api.app, alice.cookie, { slug: "race" }),
      create(api.app, alice.cookie, { slug: "race" }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const winner = first.status === 201 ? first : second;
    const loser = first.status === 201 ? second : first;
    expect(loser.error?.code).toBe("projects_slug_taken");

    expect(await listing(root)).toEqual([`${createdId(winner)}.git`]);
    expect(await projectRows(database.db)).toHaveLength(1);
    expect(await projectsEvents(database.db)).toHaveLength(1);
  });

  it("绕过接口直接往表里插一条同短名的行，被库里的唯一约束拒绝", async () => {
    const { alice } = await stage(database.db, await roots.fresh());
    const taken = await seedProject(database.db, { slug: "taken", createdById: alice.user.id });
    const refused: unknown = await createProjectsRepo()
      .insert(database.db, {
        id: randomUUID(),
        slug: taken.slug,
        displayName: "冒名",
        avatar: "",
        createdById: taken.createdById,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(Error);
    expect(pgDetail(refused)).toEqual({ code: "23505", constraint: "projects_slug_unique" });
  });
});

describe("新建接口的耗时（规格「未确定」，实测写进模块卡）", () => {
  it(
    "进程内的库、真的 git：连建 10 个，量从发请求到收到 201 的时间",
    async () => {
      const { api, alice } = await stage(database.db, await roots.fresh());
      const samples: number[] = [];
      for (let i = 0; i < 10; i++) {
        const started = performance.now();
        const reply = await create(api.app, alice.cookie, { slug: `timing-${String(i)}` });
        expect(reply.status, `第 ${String(i)} 个`).toBe(201);
        samples.push(Math.round(performance.now() - started));
      }
      // 第一个请求含执行器头一回跑命令时建空配置文件的开销，单独列；统计口径是其余 9 个
      const rest = samples.slice(1).sort((a, b) => a - b);
      const stats = {
        firstCall: samples[0],
        min: rest[0],
        median: rest[Math.floor(rest.length / 2)],
        p95: rest[Math.ceil(rest.length * 0.95) - 1],
        max: rest.at(-1),
        samples,
      };
      console.log(`TIMING ${JSON.stringify(stats)}`);
      expect(samples).toHaveLength(10);
    },
    HEAVY,
  );
});
