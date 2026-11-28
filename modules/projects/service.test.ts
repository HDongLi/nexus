import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_UPDATED } from "./events.ts";
import { GitError } from "./git.ts";
import { projectRow, T0 } from "./testing/fake.ts";
import { ALICE_CALLER, BOB, CHIEF, setup, type Harness } from "./testing/setup.ts";

const SECOND = 1000;
/** 甲先建的一个（早一秒）、甲后建的一个、乙建的一个。后两个同一毫秒建成，按编号降序排。 */
const FIRST = "30000000-0000-4000-8000-000000000001";
const SECOND_PROJECT = "30000000-0000-4000-8000-000000000002";
const BOBS = "30000000-0000-4000-8000-000000000003";
const seed = () => [
  projectRow({ id: FIRST, slug: "first", createdAt: new Date(T0.getTime() - SECOND) }),
  projectRow({ id: SECOND_PROJECT, slug: "second" }),
  projectRow({ id: BOBS, slug: "bobs", createdById: BOB.id }),
];
const HEAD = `${"c0ffee".repeat(6)}abcd\n2026-11-27T08:00:00+08:00\nInitial commit\n`;

const opened: Harness[] = [];

afterEach(async () => {
  for (const harness of opened.splice(0)) await harness.removeAll();
});

const open = async (options: Parameters<typeof setup>[0] = {}): Promise<Harness> => {
  const harness = await setup(options);
  opened.push(harness);
  return harness;
};

const slugs = async (harness: Harness, caller: Parameters<Harness["service"]["list"]>[0]) =>
  (await harness.service.list(caller)).map((project) => project.slug);

describe("清单（规格 P-08 到 P-10）", () => {
  it("只回看得见的，新的在前；一条 git 都不跑（P-08、P-09）", async () => {
    const harness = await open({ seed: seed() });
    expect(await slugs(harness, ALICE_CALLER)).toEqual(["second", "first"]);
    expect(await slugs(harness, BOB)).toEqual(["bobs"]);
    // 管理员全都有
    expect(await slugs(harness, CHIEF)).toEqual(["bobs", "second", "first"]);
    expect(harness.git.calls).toEqual([]);
  });

  it("同一时刻建的两个按编号降序：编号大的在前（P-08）", async () => {
    const harness = await open({
      seed: [
        projectRow({ id: "30000000-0000-4000-8000-00000000000a", slug: "smaller" }),
        projectRow({ id: "30000000-0000-4000-8000-00000000000b", slug: "larger" }),
      ],
    });
    expect(await slugs(harness, CHIEF)).toEqual(["larger", "smaller"]);
  });

  it("可见性判定是构造时换进来的：恒假，清单为空、详情和改都当作不存在；恒真，全都在（P-10）", async () => {
    const nobody = await open({ seed: seed(), canSee: () => false });
    expect(await slugs(nobody, ALICE_CALLER)).toEqual([]);
    expect(await nobody.service.get(ALICE_CALLER, SECOND_PROJECT)).toBeUndefined();
    expect(await nobody.service.update(ALICE_CALLER, SECOND_PROJECT, { avatar: "乙" })).toEqual({
      kind: "not_found",
    });
    expect(nobody.git.calls).toEqual([]);

    const everyone = await open({ seed: seed(), canSee: () => true });
    everyone.git.headOutput = HEAD;
    expect(await slugs(everyone, BOB)).toEqual(["bobs", "second", "first"]);
    expect(await everyone.service.get(BOB, SECOND_PROJECT)).toMatchObject({
      project: { slug: "second" },
    });
    // 看得见不代表能改（P-29）
    expect(await everyone.service.update(BOB, SECOND_PROJECT, { avatar: "乙" })).toEqual({
      kind: "forbidden",
    });
  });
});

describe("详情（规格 P-11、P-25、P-26）", () => {
  it("跑一次 git，读出编号、提交时间、标题；时间换算成 UTC（P-25）", async () => {
    const harness = await open({ seed: seed() });
    harness.git.headOutput = HEAD;
    const found = await harness.service.get(ALICE_CALLER, SECOND_PROJECT);
    expect(found).toEqual({
      project: expect.objectContaining({ slug: "second" }),
      head: {
        commitId: `${"c0ffee".repeat(6)}abcd`,
        committedAt: "2026-11-27T00:00:00.000Z",
        subject: "Initial commit",
      },
    });
    expect(harness.git.calls).toHaveLength(1);
    expect(harness.git.calls[0]?.args).toEqual([
      "--git-dir",
      join(harness.root, `${SECOND_PROJECT}.git`),
      "log",
      "-1",
      "--format=%H%n%cI%n%s",
      "main",
    ]);
  });

  it("看不见和不存在回得一样，而且都不跑 git（P-11）", async () => {
    const harness = await open({ seed: seed() });
    const invisible = await harness.service.get(ALICE_CALLER, BOBS);
    const missing = await harness.service.get(ALICE_CALLER, "30000000-0000-4000-8000-000000000009");
    expect(invisible).toEqual(missing);
    expect(invisible).toBeUndefined();
    expect(harness.git.calls).toEqual([]);
  });

  it("git 失败、超时，或者输出读不出提交：抛出去，不回一个 head 为空的详情（P-26）", async () => {
    const harness = await open({ seed: seed() });
    harness.git.failAt = 1;
    await expect(harness.service.get(ALICE_CALLER, SECOND_PROJECT)).rejects.toBeInstanceOf(
      GitError,
    );
    harness.git.failAt = undefined;
    for (const output of [
      "",
      "not-a-commit\n2026-11-27\nx\n",
      `${"a".repeat(40)}\nyesterday\nx\n`,
    ]) {
      harness.git.headOutput = output;
      await expect(harness.service.get(ALICE_CALLER, SECOND_PROJECT)).rejects.toThrow(
        /最新提交读不出来/,
      );
    }
  });
});

describe("改显示名和头像字（规格 P-29 到 P-33）", () => {
  it("看得见但不是自己建的、也不是管理员：forbidden，不动库、不发事件（P-29）", async () => {
    const harness = await open({ seed: seed(), canSee: () => true });
    expect(await harness.service.update(BOB, FIRST, { displayName: "乙改的" })).toEqual({
      kind: "forbidden",
    });
    expect(harness.repo.state.projects.find((p) => p.id === FIRST)?.displayName).toBe("Alpha");
    expect(harness.eventLog.emitted).toEqual([]);
  });

  it("没变就不动：回原记录，更新时间不变，不发事件（P-31）", async () => {
    const harness = await open({ seed: seed() });
    harness.clock.tick(SECOND);
    const result = await harness.service.update(
      ALICE_CALLER,
      FIRST,
      { displayName: " Alpha ", avatar: "A" },
      "trace-same",
    );
    // 送去空白的值和库里一样，也算没变
    expect(result).toMatchObject({ kind: "ok", project: { displayName: "Alpha", updatedAt: T0 } });
    expect(harness.eventLog.emitted).toEqual([]);
    expect(harness.log.entries()).toEqual([]);
  });

  it("只改显示名：changes 只有 displayName，更新时间挪了，事件和写入在同一个事务里（P-33）", async () => {
    const harness = await open({ seed: seed() });
    harness.clock.tick(SECOND);
    const at = new Date(T0.getTime() + SECOND);
    const result = await harness.service.update(
      ALICE_CALLER,
      FIRST,
      { displayName: " 甲 " },
      "trace-2",
    );
    expect(result).toMatchObject({
      kind: "ok",
      project: { displayName: "甲", avatar: "A", updatedAt: at },
    });
    expect(harness.repo.state.projects.find((p) => p.id === FIRST)).toMatchObject({
      displayName: "甲",
      updatedAt: at,
    });
    expect(harness.eventLog.emitted).toEqual([
      {
        type: PROJECT_UPDATED,
        source: "projects",
        subject: FIRST,
        payload: {
          projectId: FIRST,
          slug: "first",
          actorId: ALICE_CALLER.id,
          changes: { displayName: { from: "Alpha", to: "甲" } },
        },
        occurredAt: at.toISOString(),
        traceId: "trace-2",
      },
    ]);
    expect(harness.eventLog.executors).toEqual([harness.tx]);
  });

  it("只改头像字、两个都改：changes 只列真变了的键（规格事件表）", async () => {
    const harness = await open({ seed: seed() });
    await harness.service.update(ALICE_CALLER, FIRST, { avatar: "乙" });
    await harness.service.update(ALICE_CALLER, FIRST, { displayName: "", avatar: "" });
    expect(
      harness.eventLog.emitted.map((event) => (event.payload as { changes: unknown }).changes),
    ).toEqual([
      { avatar: { from: "A", to: "乙" } },
      { displayName: { from: "Alpha", to: "" }, avatar: { from: "乙", to: "" } },
    ]);
  });

  it("空串就是清除（P-30）；管理员能改别人的（P-29）；看不见的当作不存在（P-11）", async () => {
    const harness = await open({ seed: seed() });
    const cleared = await harness.service.update(CHIEF, BOBS, { displayName: "", avatar: "" });
    expect(cleared).toMatchObject({ kind: "ok", project: { displayName: "", avatar: "" } });
    expect(harness.repo.state.projects.find((p) => p.id === BOBS)).toMatchObject({
      displayName: "",
      avatar: "",
    });
    expect(await harness.service.update(ALICE_CALLER, BOBS, { displayName: "偷改" })).toEqual({
      kind: "not_found",
    });
    expect(
      harness.eventLog.emitted.map((event) => (event.payload as { actorId: string }).actorId),
    ).toEqual([CHIEF.id]);
  });
});
