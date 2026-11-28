import type { Tx } from "@nexus/db";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsService } from "../service.ts";
import { callerScope, type Caller, type GroupExists, type Visibility } from "../shared.ts";
import {
  ALICE,
  createClock,
  createFakeEventLog,
  createFakeGit,
  createFakeLog,
  createFakeRepo,
  fakeDb,
  type Clock,
  type FakeEventLog,
  type FakeGit,
  type FakeLog,
  type FakeRepo,
} from "./fake.ts";

/**
 * 单元测试的装配：真的用例 + 全套内存替身。仓库根目录是一个真的临时目录（建仓要在里面写文件），
 * 用完由 removeAll 删掉。只有测试会 import。
 */

export const CHIEF_ID = "10000000-0000-4000-8000-000000000002";
export const BOB_ID = "10000000-0000-4000-8000-000000000003";
/** 甲：普通账号，不在任何组里。 */
export const ALICE_CALLER: Caller = { id: ALICE, isAdmin: false, groupIds: [] };
/** 管理员。 */
export const CHIEF: Caller = { id: CHIEF_ID, isAdmin: true, groupIds: [] };
/** 乙：另一个普通账号，不在任何组里。 */
export const BOB: Caller = { id: BOB_ID, isAdmin: false, groupIds: [] };

export interface Harness {
  service: ReturnType<typeof createProjectsService>;
  repo: FakeRepo;
  eventLog: FakeEventLog;
  git: FakeGit;
  log: FakeLog;
  clock: Clock;
  tx: Tx;
  root: string;
  removeAll(): Promise<void>;
}

export async function setup(
  options: {
    seed?: Parameters<typeof createFakeRepo>[0];
    git?: FakeGit;
    canSee?: Visibility;
    /** 「组在不在」的桩。缺省恒真：单元测试不关心组。 */
    groupExists?: GroupExists;
    /** 设了就换掉仓储（造「查重之后撞上唯一约束」那种交错）。 */
    repo?: FakeRepo;
  } = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "nexus-projects-unit-"));
  const tx = { fake: "tx" } as unknown as Tx;
  const git = options.git ?? createFakeGit();
  const clock = createClock();
  const log = createFakeLog();
  const eventLog = createFakeEventLog();
  const repo = options.repo ?? createFakeRepo(options.seed);
  const service = createProjectsService({
    db: fakeDb(tx),
    repo,
    eventLog,
    root,
    git,
    canSee: options.canSee ?? callerScope,
    groupExists: options.groupExists ?? (async () => true),
    log,
    now: clock.now,
  });
  return {
    service,
    repo,
    eventLog,
    git,
    log,
    clock,
    tx,
    root,
    removeAll: () => rm(root, { recursive: true, force: true }),
  };
}

/** 根目录下有什么（不递归，排好序）；目录不在就是空。 */
export async function listing(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => []);
}
