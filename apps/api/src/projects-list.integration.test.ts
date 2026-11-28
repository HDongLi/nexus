import type { DatabaseHandle } from "@nexus/db";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, call, createTestDatabase, T0, type Reply } from "./testing/kit.ts";
import {
  PROJECTS,
  cannedGit,
  clearProjects,
  countingGit,
  create,
  listing,
  projectRoots,
  projectRows,
  restage,
  seedProject,
  snapshot,
  stage,
  type Roots,
} from "./testing/projects.ts";

/**
 * 清单这条竖切：谁看得见、什么次序、不碰仓库；看不见和不存在的回应；旧路径和形状。
 * 这里的用例只看记录，所以记录直接种进表里，不起 git；整个文件一条 git 都不该跑，也没必要放宽超时。
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

const MISSING = "30000000-0000-4000-8000-0000000000ff";

const idsOf = async (
  app: Awaited<ReturnType<typeof boot>>["app"],
  cookie: string,
): Promise<string[]> =>
  (
    (await call(app, PROJECTS.list, { cookie })).body as { projects: { id: string }[] }
  ).projects.map((project) => project.id);

/** 去掉请求号之后的回应：状态码和整个正文。 */
function withoutRequestId(reply: Reply): string {
  return JSON.stringify({ status: reply.status, body: reply.body }).replace(
    /"requestId":"[^"]*"/g,
    '"requestId":"*"',
  );
}

describe("清单（规格 P-08 到 P-10）", () => {
  it("只回看得见的，新的在前：甲两个、乙一个；甲的清单是甲的两个，乙的只有乙的，管理员的三个全有（P-08）", async () => {
    const { api, alice, bob, chief } = await stage(database.db, await roots.fresh());
    const older = await seedProject(database.db, {
      slug: "first",
      createdById: alice.user.id,
      createdAt: new Date(T0.getTime() - 2000),
    });
    const newer = await seedProject(database.db, {
      slug: "second",
      createdById: alice.user.id,
      createdAt: new Date(T0.getTime() - 1000),
    });
    const bobs = await seedProject(database.db, { slug: "bobs", createdById: bob.user.id });

    expect(await idsOf(api.app, alice.cookie)).toEqual([newer.id, older.id]);
    expect(await idsOf(api.app, bob.cookie)).toEqual([bobs.id]);
    expect(await idsOf(api.app, chief.cookie)).toEqual([bobs.id, newer.id, older.id]);
  });

  it("同一时刻建的两个按编号降序（P-08）", async () => {
    const { api, chief } = await stage(database.db, await roots.fresh());
    const pair = [
      await seedProject(database.db, { slug: "tie-one", createdById: chief.user.id }),
      await seedProject(database.db, { slug: "tie-two", createdById: chief.user.id }),
    ];
    expect(await idsOf(api.app, chief.cookie)).toEqual(
      [pair[0]?.id, pair[1]?.id].sort((a, b) => String(b).localeCompare(String(a))),
    );
  });

  it("清单只读库：git 换成计数桩、根目录指向不存在的目录，清单照常 200，桩的调用数是 0，那个目录也没被建出来（P-09）", async () => {
    const { alice } = await stage(database.db, await roots.fresh());
    await seedProject(database.db, { slug: "one", createdById: alice.user.id });
    await seedProject(database.db, { slug: "two", createdById: alice.user.id });

    const counter = countingGit();
    const nowhere = join(await roots.fresh(), "does", "not", "exist");
    const blind = await boot({
      db: database.db,
      projectsRoot: nowhere,
      projects: { git: counter },
    });
    const reply = await call(blind.app, PROJECTS.list, { cookie: alice.cookie });
    expect(reply.status).toBe(200);
    expect((reply.body as { projects: unknown[] }).projects).toHaveLength(2);
    expect(counter.count()).toBe(0);
    expect(await listing(nowhere)).toEqual([]);
  });

  it("可见性判定是构造时换进来的：恒假，清单为空、详情 404；恒真，清单里有、详情 200（P-10）", async () => {
    const root = await roots.fresh();
    // 记录没有仓库：详情那一次 git 由桩应答
    const troupe = await stage(database.db, root, { git: cannedGit() });
    const id = (
      await seedProject(database.db, { slug: "alpha", createdById: troupe.alice.user.id })
    ).id;

    const nobody = await restage(database.db, root, troupe, {
      canSee: () => false,
      git: cannedGit(),
    });
    expect(
      (await call(nobody.api.app, PROJECTS.list, { cookie: nobody.alice.cookie })).body,
    ).toEqual({ projects: [] });
    expect(
      (await call(nobody.api.app, PROJECTS.member(id), { cookie: nobody.alice.cookie })).status,
    ).toBe(404);

    const everyone = await restage(database.db, root, troupe, {
      canSee: () => true,
      git: cannedGit(),
    });
    // 同一条记录、同一个调用者（乙，不是创建者）：只换了判定
    expect(await idsOf(everyone.api.app, everyone.bob.cookie)).toEqual([id]);
    expect(
      (await call(everyone.api.app, PROJECTS.member(id), { cookie: everyone.bob.cookie })).status,
    ).toBe(200);
  });

  it("看不见和不存在回得一样：详情和改都是 404，去掉请求号后逐字相等；对创建者它是存在的（P-11）", async () => {
    const { api, alice, bob } = await stage(database.db, await roots.fresh(), { git: cannedGit() });
    const id = (
      await seedProject(database.db, {
        slug: "alpha",
        displayName: "甲",
        createdById: alice.user.id,
      })
    ).id;

    const invisibleDetail = await call(api.app, PROJECTS.member(id), { cookie: bob.cookie });
    const missingDetail = await call(api.app, PROJECTS.member(MISSING), { cookie: bob.cookie });
    expect(withoutRequestId(invisibleDetail)).toBe(withoutRequestId(missingDetail));
    const patchAs = (target: string): Promise<Reply> =>
      call(api.app, PROJECTS.member(target), {
        method: "PATCH",
        cookie: bob.cookie,
        body: { displayName: "乙改的" },
      });
    const invisiblePatch = await patchAs(id);
    const missingPatch = await patchAs(MISSING);
    expect(withoutRequestId(invisiblePatch)).toBe(withoutRequestId(missingPatch));

    for (const reply of [invisibleDetail, missingDetail, invisiblePatch, missingPatch]) {
      expect(reply.status).toBe(404);
      expect(reply.error?.code).toBe("not_found");
      expect(reply.error?.requestId).toBe(reply.requestId);
    }
    expect((await call(api.app, PROJECTS.member(id), { cookie: alice.cookie })).status).toBe(200);
    // 旁人的那次改没有落下
    expect(await projectRows(database.db)).toContainEqual(
      expect.objectContaining({ id, display_name: "甲" }),
    );
  });
});

describe("形状、旧路径、没登录（规格 P-02、P-03、P-32）", () => {
  it("形状不合一律 400 invalid_request：缺短名、带没声明的键、短名和显示名头像字不合规、编号不是 UUID、改的时候带 slug 或什么都不带；现场不变（P-02、P-32）", async () => {
    const root = await roots.fresh();
    const { api, alice } = await stage(database.db, root, { git: cannedGit() });
    const id = (await seedProject(database.db, { slug: "alpha", createdById: alice.user.id }, root))
      .id;
    const before = await snapshot(database.db, root);
    const member = PROJECTS.member(id);
    const patchAs = (target: string, body: unknown): Promise<Reply> =>
      call(api.app, target, { method: "PATCH", cookie: alice.cookie, body });

    const bad: Array<[string, () => Promise<Reply>]> = [
      ["缺 slug", () => create(api.app, alice.cookie, { displayName: "没有短名" })],
      ["多一个键", () => create(api.app, alice.cookie, { slug: "beta", extra: 1 })],
      ["大写短名", () => create(api.app, alice.cookie, { slug: "Beta" })],
      [
        "显示名 41 个",
        () => create(api.app, alice.cookie, { slug: "beta", displayName: "有".repeat(41) }),
      ],
      ["头像字三个字", () => create(api.app, alice.cookie, { slug: "beta", avatar: "三个字" })],
      [
        "详情编号不是 UUID",
        () => call(api.app, PROJECTS.member("not-a-uuid"), { cookie: alice.cookie }),
      ],
      ["改的编号不是 UUID", () => patchAs(PROJECTS.member("not-a-uuid"), { displayName: "甲" })],
      ["改的时候带 slug", () => patchAs(member, { slug: "renamed" })],
      [
        "改的时候 slug 和显示名一起带",
        () => patchAs(member, { slug: "renamed", displayName: "甲" }),
      ],
      ["改的时候什么都不带", () => patchAs(member, {})],
      ["显示名不是字符串", () => patchAs(member, { displayName: 123 })],
      [
        "标了 JSON 却没有正文",
        () =>
          call(api.app, PROJECTS.list, {
            method: "POST",
            cookie: alice.cookie,
            headers: { "content-type": "application/json" },
          }),
      ],
    ];
    for (const [label, run] of bad) {
      const reply = await run();
      expect(reply.status, label).toBe(400);
      expect(reply.error?.code, label).toBe("invalid_request");
      expect(reply.error?.requestId, label).toBe(reply.requestId);
    }

    expect(await snapshot(database.db, root)).toEqual(before);
    const detail = await call(api.app, member, { cookie: alice.cookie });
    expect((detail.body as { project: { slug: string } }).project.slug).toBe("alpha");
  });

  it("旧的 /api/projects/* 路径不保留，七个都回 404 not_found（P-03）", async () => {
    const { api, alice } = await stage(database.db, await roots.fresh());
    const old: Array<[string, string, boolean]> = [
      ["GET", "/api/projects", false],
      ["POST", "/api/projects/create", true],
      ["GET", "/api/projects/alpha/head", false],
      ["GET", "/api/projects/alpha/alias", false],
      ["PUT", "/api/projects/alpha/avatar", true],
      ["GET", "/api/projects/alpha/ai-cfg", false],
      ["POST", "/api/projects/alpha/ai-cfg", true],
    ];
    expect(old).toHaveLength(7);
    for (const [method, path, hasBody] of old) {
      const reply = await call(api.app, path, {
        method,
        cookie: alice.cookie,
        ...(hasBody ? { body: {} } : {}),
      });
      expect(reply.status, `${method} ${path}`).toBe(404);
      expect(reply.error?.code, `${method} ${path}`).toBe("not_found");
    }
  });

  it("没登录：四条路由都是 401 auth_required", async () => {
    const { api } = await stage(database.db, await roots.fresh());
    const id = "30000000-0000-4000-8000-000000000001";
    const replies = [
      await call(api.app, PROJECTS.list),
      await call(api.app, PROJECTS.list, { method: "POST", body: { slug: "alpha" } }),
      await call(api.app, PROJECTS.member(id)),
      await call(api.app, PROJECTS.member(id), { method: "PATCH", body: { displayName: "甲" } }),
    ];
    for (const reply of replies) {
      expect(reply.status).toBe(401);
      expect(reply.error?.code).toBe("auth_required");
    }
  });
});
