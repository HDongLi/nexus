import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_CREATED } from "./events.ts";
import { GitError } from "./git.ts";
import { isUniqueViolation } from "./shared.ts";
import { createFakeGit, createFakeRepo, projectRow, T0 } from "./testing/fake.ts";
import { ALICE_CALLER, listing, setup, type Harness } from "./testing/setup.ts";

/**
 * 新建的用例：git 是桩，所以这里看的是顺序、失败时收不收得干净、记录和事件长什么样。
 * 真的 git 建出来的仓库什么样，在 apps/api 的集成测试里验（规格 P-16 到 P-19）。
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const opened: Harness[] = [];

afterEach(async () => {
  for (const harness of opened.splice(0)) await harness.removeAll();
});

const open = async (options: Parameters<typeof setup>[0] = {}): Promise<Harness> => {
  const harness = await setup(options);
  opened.push(harness);
  return harness;
};

describe("新建", () => {
  it("建成：四条 git 命令按顺序跑，记录七个字段对上，事件和记录交给同一个事务（P-07、P-14、P-18、P-24）", async () => {
    const harness = await open();
    let readme = "";
    harness.git.afterCall = async (call) => {
      // 提交之前看一眼落脚目录：初始提交的标题有显示名用显示名
      if (call.args[0] === "commit" && call.cwd)
        readme = await readFile(join(call.cwd, "README.md"), "utf8");
    };

    const result = await harness.service.create(
      { ...ALICE_CALLER },
      { slug: "alpha", displayName: "  甲  ", avatar: " A " },
      "trace-1",
    );
    if (result.kind !== "ok") throw new Error(`应当建成，实际是 ${result.kind}`);
    const project = result.project;
    // 非管理员照样能建；创建人是调用者的编号；创建时间等于更新时间；显示名和头像字存的是去掉首尾空白之后的值
    expect(project).toEqual({
      id: expect.stringMatching(UUID),
      slug: "alpha",
      displayName: "甲",
      avatar: "A",
      createdById: ALICE_CALLER.id,
      createdAt: T0,
      updatedAt: T0,
    });
    const work = join(harness.root, ".tmp", project.id);
    expect(harness.git.calls.map((call) => call.args)).toEqual([
      // 分支名显式给
      ["init", "-b", "main"],
      ["add", "--", "README.md", "AGENTS.md", ".gitignore"],
      ["commit", "-m", "Initial commit"],
      // 仓库落在 <根目录>/<编号>.git，不拿短名命名（P-19）
      ["clone", "--bare", "--", work, join(harness.root, `${project.id}.git`)],
    ]);
    expect(harness.git.calls.slice(0, 3).map((call) => call.cwd)).toEqual([work, work, work]);
    expect(readme).toBe("# 甲\n");

    expect(harness.repo.state.projects).toHaveLength(1);
    expect(harness.eventLog.emitted).toEqual([
      {
        type: PROJECT_CREATED,
        source: "projects",
        subject: project.id,
        payload: { projectId: project.id, slug: "alpha", actorId: ALICE_CALLER.id },
        occurredAt: T0.toISOString(),
        traceId: "trace-1",
      },
    ]);
    // 事件是在写记录的那个事务上发的
    expect(harness.eventLog.executors).toEqual([harness.tx]);
    expect(harness.log.entries()).toEqual([]);
  });

  it("没给显示名：记录里是空串，仓库里的标题用短名（P-07、P-17）", async () => {
    const harness = await open();
    let title = "";
    harness.git.afterCall = async (call) => {
      if (call.args[0] === "commit" && call.cwd)
        title = await readFile(join(call.cwd, "README.md"), "utf8");
    };
    const result = await harness.service.create(ALICE_CALLER, { slug: "beta" });
    expect(result).toMatchObject({ kind: "ok", project: { displayName: "", avatar: "" } });
    expect(title).toBe("# beta\n");
  });

  it("短名已被占用：直接回 slug_taken，一条 git 都不跑、不发事件（P-15）", async () => {
    const harness = await open({ seed: [projectRow({ slug: "alpha" })] });
    expect(await harness.service.create(ALICE_CALLER, { slug: "alpha" })).toEqual({
      kind: "slug_taken",
    });
    expect(harness.git.calls).toEqual([]);
    expect(harness.eventLog.emitted).toEqual([]);
    expect(harness.repo.state.projects).toHaveLength(1);
    // 占用者看不看得见都一样回：换一个看不见这条记录的人
    expect(
      await harness.service.create({ id: "someone-else", isAdmin: false }, { slug: "alpha" }),
    ).toEqual({
      kind: "slug_taken",
    });
  });

  it("建仓的任何一步 git 失败：回 failed，不留记录、不留事件、落脚目录删干净；原因连同请求号进日志（P-05、P-20）", async () => {
    // 四条命令，哪一条失败都一样收场
    for (let step = 1; step <= 4; step++) {
      const git = createFakeGit();
      git.failAt = step;
      const harness = await open({ git });
      const result = await harness.service.create(
        ALICE_CALLER,
        { slug: "alpha" },
        `trace-${String(step)}`,
      );
      expect(result).toEqual({ kind: "failed" });
      expect(harness.git.calls).toHaveLength(step);
      expect(harness.repo.state.projects).toEqual([]);
      expect(harness.eventLog.emitted).toEqual([]);
      expect(await listing(harness.root)).toEqual([]);
      const logged = harness.log.entries();
      expect(logged).toHaveLength(1);
      const entry = logged[0];
      if (!entry) throw new Error("应当有一条错误日志");
      expect(entry).toMatchObject({
        level: "error",
        message: "工程没建成",
        info: { requestId: `trace-${String(step)}`, step: "建仓库" },
      });
      // 日志里有底下那一步的命令，排查时知道挂在哪
      expect((entry.info.err as GitError).args).toEqual(harness.git.calls[step - 1]?.args);
    }
  });

  it("查重之后、写进来之前被别人抢了先：撞上唯一约束回 slug_taken，不算失败、不记错误（P-21）", async () => {
    const seeded = createFakeRepo([projectRow({ slug: "alpha" })]);
    // 造那个交错：查重的时候还查不到
    const racing = { ...seeded, findBySlug: async () => undefined };
    const harness = await open({ repo: racing });
    expect(await harness.service.create(ALICE_CALLER, { slug: "alpha" })).toEqual({
      kind: "slug_taken",
    });
    expect(harness.eventLog.emitted).toEqual([]);
    expect(harness.log.entries()).toEqual([]);
    expect(await listing(harness.root)).toEqual([]);
  });

  it("认得出唯一约束：错误码在最外层、或者包在 drizzle 的 cause 里，都算；别的错误码和没有 cause 的都不算", () => {
    const wrapped = (code: string): Error =>
      new Error("Failed query: insert", { cause: Object.assign(new Error("x"), { code }) });
    expect(isUniqueViolation(Object.assign(new Error("x"), { code: "23505" }))).toBe(true);
    expect(isUniqueViolation(wrapped("23505"))).toBe(true);
    expect(isUniqueViolation(new Error("outer", { cause: wrapped("23505") }))).toBe(true);
    for (const other of [wrapped("23503"), new Error("plain"), null, undefined, "23505", {}]) {
      expect(isUniqueViolation(other), String(other)).toBe(false);
    }
    // cause 成环也转得出来
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop)).toBe(false);
  });

  it("记录写不进库：回 failed，不留事件；原因连同请求号进日志（P-05、P-20、P-24）", async () => {
    const harness = await open();
    harness.repo.failAfterInsert = new Error("磁盘满了");
    expect(await harness.service.create(ALICE_CALLER, { slug: "alpha" }, "trace-disk")).toEqual({
      kind: "failed",
    });
    expect(harness.eventLog.emitted).toEqual([]);
    const logged = harness.log.entries();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: "error",
      message: "工程没建成",
      info: { requestId: "trace-disk", step: "写记录", err: { message: "磁盘满了" } },
    });
    expect(await listing(harness.root)).toEqual([]);
  });
});
