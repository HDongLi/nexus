import type { DatabaseHandle } from "@nexus/db";
import { createGitRunner } from "@nexus/projects";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, call, createTestDatabase, loginAs, T0 } from "./testing/kit.ts";
import {
  clearProjects,
  createdId,
  create,
  git,
  listing,
  PASSWORD,
  PROJECTS,
  projectRoots,
  projectRows,
  projectsEvents,
  stage,
  type Roots,
} from "./testing/projects.ts";

/**
 * 新建这条竖切：内存库 → 真迁移 → 真路由 → 真 cookie → 真的 git 在临时目录里建裸仓库。
 * 断言仓库的事实就直接读仓库，断言记录就直接查表。
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
  // 每个用例从没有工程的库开始；账号和登录整个文件只用一回，由 stage 记住。
  await clearProjects(database.db);
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bareOf = (root: string, id: string): string => join(root, `${id}.git`);

describe("新建", () => {
  it("非管理员新建：201，正文恰好七个键；读表七个字段逐个对上，创建时间等于更新时间（P-07、P-14）", async () => {
    const root = await roots.fresh();
    const { api, alice } = await stage(database.db, root);
    const reply = await create(api.app, alice.cookie, {
      slug: "alpha",
      displayName: "甲的工程",
      avatar: "甲",
    });
    expect(reply.status).toBe(201);
    expect(reply.body).toEqual({
      project: {
        id: expect.stringMatching(UUID),
        slug: "alpha",
        displayName: "甲的工程",
        avatar: "甲",
        createdById: alice.user.id,
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      },
    });

    const rows = await projectRows(database.db);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      id: createdId(reply),
      slug: "alpha",
      display_name: "甲的工程",
      avatar: "甲",
      created_by_id: alice.user.id,
    });
    expect(row?.created_at).toEqual(T0);
    expect(row?.updated_at).toEqual(row?.created_at);
  });

  it("重名：一个 201、一个 409 projects_slug_taken；换一个人也一样回；第二次什么都不留（P-15）", async () => {
    const root = await roots.fresh();
    const { api, alice, bob } = await stage(database.db, root);
    const first = await create(api.app, alice.cookie, { slug: "alpha" });
    const again = await create(api.app, alice.cookie, { slug: "alpha" });
    // 乙看不见甲的工程，占用对他一样是占用
    const outsider = await create(api.app, bob.cookie, { slug: "alpha" });
    expect([first.status, again.status, outsider.status]).toEqual([201, 409, 409]);
    expect(again.error).toMatchObject({
      code: "projects_slug_taken",
      requestId: again.requestId,
    });
    expect(outsider.error?.code).toBe("projects_slug_taken");
    expect(await listing(root)).toEqual([`${createdId(first)}.git`]);
    expect(await projectRows(database.db)).toHaveLength(1);
    expect(await projectsEvents(database.db)).toHaveLength(1);
  });

  it("建成的样子：根目录恰好多一个 <编号>.git；克隆得出来、分支 main、恰好一个提交、恰好三个文件、hooks 干净；重建应用后详情仍读得到提交（P-16、P-17、P-19）", async () => {
    const root = await roots.fresh();
    const { api, alice } = await stage(database.db, root);
    const reply = await create(api.app, alice.cookie, { slug: "alpha", displayName: "甲的工程" });
    const id = createdId(reply);
    const bare = bareOf(root, id);
    // 落脚目录用完就删，根目录里恰好多出一个以编号命名的裸仓库
    expect(await listing(root)).toEqual([`${id}.git`]);
    expect((await git(["--git-dir", bare, "rev-parse", "--is-bare-repository"])).trim()).toBe(
      "true",
    );

    const cloneDir = join(root, "clone-check");
    await git(["clone", bare, cloneDir]);
    expect((await git(["rev-parse", "--abbrev-ref", "HEAD"], cloneDir)).trim()).toBe("main");
    expect((await git(["rev-list", "--count", "HEAD"], cloneDir)).trim()).toBe("1");

    // 内容从仓库里读（blob），不从工作树读：工作树里的换行跟开发机的 git 配置走
    const files = (await git(["ls-tree", "-r", "--name-only", "HEAD"], cloneDir))
      .trim()
      .split("\n");
    expect(files.sort()).toEqual([".gitignore", "AGENTS.md", "README.md"]);
    const show = (path: string): Promise<string> => git(["show", `HEAD:${path}`], cloneDir);
    expect(await show("README.md")).toBe("# 甲的工程\n");
    const agents = await show("AGENTS.md");
    expect(agents.startsWith("# 甲的工程\n")).toBe(true);
    expect(agents).toContain("平台");
    expect(agents).toContain("`main`");
    expect(agents).toContain("智能体");
    const ignore = await show(".gitignore");
    expect(ignore).toContain(".env");
    expect(ignore).toContain("!.env.example");
    expect(ignore).toContain("*.log");
    expect(ignore).not.toContain("node_modules");
    const hooks = (await readdir(join(bare, "hooks"))).filter((name) => !name.endsWith(".sample"));
    expect(hooks).toEqual([]);

    // 换一个应用（相当于进程重启），同一个编号的详情仍读得到提交
    const restarted = await boot({ db: database.db, projectsRoot: root });
    const { cookie } = await loginAs(restarted.app, "alice", PASSWORD);
    const detail = await call(restarted.app, PROJECTS.member(id), { cookie });
    expect(detail.status).toBe(200);
    const head = (detail.body as { project: { head: { commitId: string } } }).project.head;
    expect(head.commitId).toBe((await git(["rev-parse", "HEAD"], cloneDir)).trim());
  });

  it("不读服务器用户的 git 配置：两个初始提交的作者和提交者都是那组常量，裸仓 HEAD 指向 refs/heads/main（P-18）", async () => {
    const root = await roots.fresh();
    // 一份不一样的全局配置，放在 git 默认会读的地方：用户的家目录。家和对照仓库都不放进工程根目录
    const sandbox = await roots.fresh();
    const home = join(sandbox, "home");
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, ".gitconfig"),
      "[user]\n\tname = Someone Else\n\temail = someone@example.com\n[init]\n\tdefaultBranch = trunk\n",
      "utf8",
    );
    const env = { HOME: home, USERPROFILE: home };
    // 对照：不隔离的话这份配置是活的，默认分支会变成 trunk
    const probe = join(sandbox, "probe");
    await git(["init", probe], undefined, env);
    expect((await git(["symbolic-ref", "HEAD"], probe, env)).trim()).toBe("refs/heads/trunk");

    const { api, alice } = await stage(database.db, root, { git: createGitRunner({ env }) });
    const ids = [
      createdId(await create(api.app, alice.cookie, { slug: "one" })),
      createdId(await create(api.app, alice.cookie, { slug: "two" })),
    ];
    expect(await listing(root)).toEqual(ids.map((id) => `${id}.git`).sort());
    for (const id of ids) {
      const bare = bareOf(root, id);
      expect(
        (await git(["--git-dir", bare, "log", "-1", "--format=%an <%ae>|%cn <%ce>"])).trim(),
      ).toBe("nexus <nexus@localhost>|nexus <nexus@localhost>");
      expect((await git(["--git-dir", bare, "symbolic-ref", "HEAD"])).trim()).toBe(
        "refs/heads/main",
      );
    }
  });

  it("建成的事件：类型、source、subject、payload 的键集合照表；traceId 等于响应头里的请求号（P-24、P-34）", async () => {
    const root = await roots.fresh();
    const { api, alice } = await stage(database.db, root);
    const reply = await create(api.app, alice.cookie, { slug: "alpha" }, "trace-created");
    const id = createdId(reply);
    expect(reply.requestId).toBe("trace-created");
    expect(await projectsEvents(database.db)).toEqual([
      {
        type: "projects.project.created",
        source: "projects",
        subject: id,
        payload: { projectId: id, slug: "alpha", actorId: alice.user.id },
        trace_id: "trace-created",
      },
    ]);
  });
});
