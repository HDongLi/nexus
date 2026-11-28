import type { Db, Tx } from "@nexus/db";
import type { EmitInput, EventRecord } from "@nexus/event-log";
import { GitError, type GitOutput, type GitRunner } from "../git.ts";
import type { NewProject, ProjectRecord, ProjectRepo } from "../repo.ts";

/**
 * 给单元测试用的替身：仓储、数据库、事件日志、git 执行器、时钟都在内存里，不碰真的库。
 * 仓储的语义照 repo.ts 的 SQL 写，包括「短名撞上唯一约束报 23505」。
 * 文件名不带 .test，所以 vitest 不把它当测试跑；它只有测试会 import。
 */

export const T0 = new Date("2026-11-27T00:00:00.000Z");
export const ALICE = "10000000-0000-4000-8000-000000000001";

export function projectRow(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    slug: "alpha",
    displayName: "Alpha",
    avatar: "A",
    createdById: ALICE,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export interface FakeRepo extends ProjectRepo {
  state: { projects: ProjectRecord[] };
  /** 设了，每条记录写进去之后都抛它：验「记录写不进库时回到什么都没发生过」（规格 P-20）。 */
  failAfterInsert?: unknown;
}

export function createFakeRepo(seed: ProjectRecord[] = []): FakeRepo {
  // 预置的行复制一份再收：用例会就地改它们，直接收引用的话，一个测试改过的行会漏给下一个测试。
  const state: FakeRepo["state"] = { projects: seed.map((project) => ({ ...project })) };
  const find = (id: string): ProjectRecord | undefined => state.projects.find((p) => p.id === id);
  const repo: FakeRepo = {
    state,
    async findBySlug(_ex, slug) {
      return state.projects.find((p) => p.slug === slug);
    },
    async findById(_ex, id) {
      return find(id);
    },
    async listAll() {
      // 和真仓储一样：创建时间降序，同一时刻按编号降序。
      return [...state.projects]
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
        )
        .map((project) => ({ ...project }));
    },
    async insert(_ex, row: NewProject) {
      if (state.projects.some((p) => p.slug === row.slug)) {
        // 照真库的形状抛：drizzle 把数据库的错误包在它自己的 DrizzleQueryError 的 cause 上
        throw new Error('Failed query: insert into "projects"', {
          cause: Object.assign(new Error("duplicate key value violates unique constraint"), {
            code: "23505",
          }),
        });
      }
      const stored = { ...row } as ProjectRecord;
      state.projects.push(stored);
      if (repo.failAfterInsert !== undefined) throw repo.failAfterInsert;
      return { ...stored };
    },
    async updateProfile(_ex, id, profile, at) {
      const project = find(id);
      if (!project) return;
      project.displayName = profile.displayName;
      project.avatar = profile.avatar;
      project.updatedAt = at;
    },
  };
  return repo;
}

const fakeTx = { fake: "tx" } as unknown as Tx;

/** 一个假数据库：开事务就是把事务对象原样交给回调，不做回滚（单元测试不验回滚，那是集成测试的事）。 */
export function fakeDb(tx: Tx = fakeTx): Db {
  return { transaction: (work: (t: Tx) => Promise<unknown>) => work(tx) } as unknown as Db;
}

export interface FakeEventLog {
  emit(input: EmitInput, tx?: Tx): Promise<EventRecord>;
  emitted: EmitInput[];
  /** 每条事件是在哪个执行者上写的：undefined 是没开事务，否则是那个事务对象。 */
  executors: (Tx | undefined)[];
}

const EVENT_NAME = /^[a-z][a-z0-9-]*\.[a-z][a-z-]*(?:\.[a-z][a-z-]*)?$/;

export function createFakeEventLog(): FakeEventLog {
  const emitted: EmitInput[] = [];
  const executors: (Tx | undefined)[] = [];
  return {
    emitted,
    executors,
    async emit(input, tx) {
      // 和真的事件日志一样先看事件名：不合规的在这儿就写不进去。
      if (!EVENT_NAME.test(input.type)) throw new Error(`事件不合信封：type ${input.type}`);
      emitted.push(input);
      executors.push(tx);
      return {
        id: emitted.length,
        type: input.type,
        source: input.source,
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        payload: input.payload,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
      };
    },
  };
}

export interface FakeGitCall {
  args: string[];
  cwd: string | undefined;
}

export interface FakeGit extends GitRunner {
  calls: FakeGitCall[];
  /** 第 n 次调用（从 1 数）直接失败，什么都不做。设回 undefined 就不再失败。 */
  failAt?: number | undefined;
  /** `log` 那条命令的输出。 */
  headOutput?: string;
  /** 每次调用之后可以看一眼：比如在 clone 之前看落脚目录里写了什么。 */
  afterCall?: (call: FakeGitCall) => Promise<void>;
}

export function createFakeGit(): FakeGit {
  const git: FakeGit = {
    calls: [],
    async run(args, cwd) {
      const call = { args: [...args], cwd };
      git.calls.push(call);
      await git.afterCall?.(call);
      if (git.failAt === git.calls.length) {
        throw new GitError({
          args,
          exitCode: 128,
          stderr: "fatal: 桩命令故意失败",
          timedOut: false,
          timeoutMs: 1000,
          cause: undefined,
        });
      }
      // 读最新提交那条命令以 --git-dir 开头，所以按「含不含 log」认它
      const output: GitOutput = args.includes("log")
        ? { stdout: git.headOutput ?? "", stderr: "" }
        : { stdout: "", stderr: "" };
      return output;
    },
  };
  return git;
}

/** 可以拨的时钟。 */
export interface Clock {
  now(): Date;
  tick(ms: number): void;
}

export function createClock(start: Date = T0): Clock {
  const current = new Date(start.getTime());
  return {
    now: () => new Date(current.getTime()),
    tick: (ms) => {
      current.setTime(current.getTime() + ms);
    },
  };
}

/** 收进内存的日志：断言「底层原因连同请求号写进了日志」（规格 P-05）。 */
export interface LogEntry {
  level: "warn" | "error";
  info: Record<string, unknown>;
  message: string;
}

export interface FakeLog {
  warn(info: Record<string, unknown>, message: string): void;
  error(info: Record<string, unknown>, message: string): void;
  entries(): LogEntry[];
}

export function createFakeLog(): FakeLog {
  const lines: LogEntry[] = [];
  return {
    warn: (info, message) => void lines.push({ level: "warn", info, message }),
    error: (info, message) => void lines.push({ level: "error", info, message }),
    entries: () => lines.map((line) => ({ ...line })),
  };
}
