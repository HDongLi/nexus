import type { Db } from "@nexus/db";
import type { UserRecord } from "@nexus/identity";
import { createIdentityRepo } from "@nexus/identity";
import {
  createGitRunner,
  createProjectsRepo,
  type GitRunner,
  type ProjectRecord,
} from "@nexus/projects";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type { ProjectsOptions } from "../compose.ts";
import { T0, boot, call, loginAs, seedUser, type Reply, type TestApp } from "./kit.ts";

/**
 * 工程模块集成测试的公用件：仓库根目录的临时目录、查表、测试自己用的真 git、几样桩。
 * 只有 *.integration.test.ts 会 import 它。
 */

export const PROJECTS = {
  list: "/api/v1/projects",
  member: (id: string): string => `/api/v1/projects/${id}`,
} as const;

export const PASSWORD = "alice-password-1";

/**
 * 本身就要起十几回真进程的用例的超时：单独跑也超过 vitest 默认的 5 秒，所以照建账号脚本的集成测试的办法（SPAWNING）
 * 显式给。别的用例用默认值。
 */
export const HEAVY = 60_000;

/** 装好的应用加三个已经登录的账号。 */
export interface Troupe {
  api: TestApp;
  root: string;
  alice: Session;
  bob: Session;
  chief: Session;
}

/** 三个已经登录的账号。 */
export interface Sessions {
  alice: Session;
  bob: Session;
  chief: Session;
}

/** 每个库记住一份登录：一个文件里只登录一回。会话在库里，不在应用里，之后每个用例、每个应用都沿用。 */
const signedIn = new WeakMap<Db, Sessions>();

/**
 * 甲、乙（普通账号）和管理员 chief 各建一个账号并登录。头一回要算口令散列，之后沿用。
 * 用它的文件在一个用例结束时不许清身份表，只清工程（见 clearProjects）。
 */
export async function actors(db: Db, app: TestApp["app"]): Promise<Sessions> {
  const cached = signedIn.get(db);
  if (cached) return cached;
  const sessions: Sessions = {
    alice: await signIn(db, app, "alice"),
    bob: await signIn(db, app, "bob"),
    chief: await signIn(db, app, "chief", true),
  };
  signedIn.set(db, sessions);
  return sessions;
}

/** 装一个应用，仓库根目录是 root；甲、乙和管理员 chief 都带着登录。 */
export async function stage(db: Db, root: string, options: ProjectsOptions = {}): Promise<Troupe> {
  const api = await boot({
    db,
    projectsRoot: root,
    ...(empty(options) ? {} : { projects: options }),
  });
  return { api, root, ...(await actors(db, api.app)) };
}

/**
 * 再装一个应用（换根目录、换可替换件），沿用已有的登录：会话在库里，不在应用里。
 * 每次登录都要算一回口令散列，一个用例里装好几个应用时，能省不少时间。
 */
export async function restage(
  db: Db,
  root: string,
  troupe: Troupe,
  options: ProjectsOptions = {},
): Promise<Troupe> {
  const api = await boot({
    db,
    projectsRoot: root,
    ...(empty(options) ? {} : { projects: options }),
  });
  return { api, root, alice: troupe.alice, bob: troupe.bob, chief: troupe.chief };
}

/**
 * 直接往表里放一条工程记录：不建仓库、不发事件，不走用例。
 * 只看记录的用例（清单、可见性、404、改显示名、引用约束）用它，不必为一条记录去起四回 git。
 * 给了 root 就再配一个空的 <编号>.git 目录：这样「根目录里有什么」的前后对比才有内容。
 */
export async function seedProject(
  db: Db,
  input: {
    slug: string;
    createdById: string;
    displayName?: string;
    avatar?: string;
    createdAt?: Date;
  },
  root?: string,
): Promise<ProjectRecord> {
  const at = input.createdAt ?? T0;
  const row = await createProjectsRepo().insert(db, {
    id: randomUUID(),
    slug: input.slug,
    displayName: input.displayName ?? "",
    avatar: input.avatar ?? "",
    createdById: input.createdById,
    createdAt: at,
    updatedAt: at,
  });
  if (root !== undefined) await mkdir(join(root, `${row.id}.git`), { recursive: true });
  return row;
}

/**
 * 数据库报的错码和约束名，沿着 cause 链找：drizzle 把数据库的错误包在它自己的 DrizzleQueryError 的 cause 上。
 * 进程内的库基于新版的 Postgres，`ON DELETE RESTRICT` 被拒绝时报 23001（老版本报 23503）；
 * 认哪一条约束拦的，比认错误码准（2026-11-27 实测）。
 */
export function pgDetail(err: unknown): { code?: string; constraint?: string } {
  let current = err;
  for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth++) {
    const { code, constraint } = current as { code?: unknown; constraint?: unknown };
    if (typeof code === "string") {
      return {
        code,
        ...(typeof constraint === "string" ? { constraint } : {}),
      };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return {};
}

/** 发一次新建。 */
export function create(
  app: TestApp["app"],
  cookie: string,
  body: Record<string, unknown>,
  requestId?: string,
): Promise<Reply> {
  return call(app, PROJECTS.list, {
    method: "POST",
    cookie,
    body,
    ...(requestId === undefined ? {} : { requestId }),
  });
}

const empty = (value: object): boolean => Object.keys(value).length === 0;

/** 新建回应（201）里的工程编号；不是 201 就直接说清楚。 */
export function createdId(reply: Reply): string {
  const project = (reply.body as { project?: { id?: unknown } } | undefined)?.project;
  if (reply.status !== 201 || typeof project?.id !== "string") {
    throw new Error(`新建没有回 201：${String(reply.status)} ${JSON.stringify(reply.body)}`);
  }
  return project.id;
}

/**
 * 正文里有没有出现服务器上的路径（规格 P-05）。原样、转成 JSON 之后的写法（反斜杠成了两个）、
 * 换成正斜杠的写法，三种都查。
 */
export function leaksPath(text: string, path: string): boolean {
  const forms = [path, JSON.stringify(path).slice(1, -1), path.split("\\").join("/")];
  return forms.some((form) => form !== "" && text.includes(form));
}

/** 等一个进程结束：刚被结束的进程，它的进程号可能要过一小会儿才查不到。超时就抛。 */
export async function eventuallyDead(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (performance.now() > deadline) throw new Error(`进程 ${String(pid)} 还在`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 一批用例共用的东西：每个用例一个新的临时目录当仓库根目录，全部在 afterAll 删掉。 */
export interface Roots {
  fresh(): Promise<string>;
  removeAll(): Promise<void>;
}

export function projectRoots(): Roots {
  const created: string[] = [];
  return {
    async fresh() {
      const dir = await mkdtemp(join(tmpdir(), "nexus-projects-"));
      created.push(dir);
      return dir;
    },
    async removeAll() {
      for (const dir of created)
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/** 目录下有什么（不递归，排好序）；目录不在就是空。 */
export async function listing(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => []);
}

/** 现场三项：根目录下的仓库目录、全部记录、工程模块发的全部事件。规格 P-20 的验收拿它前后比。 */
export async function snapshot(
  db: Db,
  root: string,
): Promise<{ dirs: string[]; records: ProjectRow[]; events: EventRow[] }> {
  return {
    dirs: await listing(root),
    records: await projectRows(db),
    events: await projectsEvents(db),
  };
}

export interface ProjectRow {
  id: string;
  slug: string;
  display_name: string;
  avatar: string;
  created_by_id: string;
  created_at: Date;
  updated_at: Date;
}

/** 直接查表读出来的工程记录，新的在前。 */
export async function projectRows(db: Db): Promise<ProjectRow[]> {
  const rows = await db.execute(
    sql`select id, slug, display_name, avatar, created_by_id, created_at, updated_at from projects order by created_at desc, id desc`,
  );
  return (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    display_name: row.display_name as string,
    avatar: row.avatar as string,
    created_by_id: row.created_by_id as string,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  }));
}

export interface EventRow {
  type: string;
  source: string;
  subject: string | null;
  payload: Record<string, unknown>;
  trace_id: string | null;
}

/** 工程模块发的事件，按写入的先后。 */
export async function projectsEvents(db: Db, type?: string): Promise<EventRow[]> {
  const condition: SQL[] = [sql`source = 'projects'`];
  if (type !== undefined) condition.push(sql`type = ${type}`);
  const rows = await db.execute(
    sql`select type, source, subject, payload, trace_id from events where ${sql.join(condition, sql` and `)} order by id`,
  );
  return (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    type: row.type as string,
    source: row.source as string,
    subject: (row.subject ?? null) as string | null,
    payload: row.payload as Record<string, unknown>,
    trace_id: (row.trace_id ?? null) as string | null,
  }));
}

/** 清掉工程模块的表和它发的事件。要先于 clearIdentity：工程记录引用着账号，关系表引用着组。 */
export async function clearProjects(db: Db): Promise<void> {
  await db.execute(sql`delete from project_groups`);
  await db.execute(sql`delete from projects`);
  await db.execute(sql`delete from events where source = 'projects'`);
}

/** 直接查关系表：一个组看得见的工程编号，按编号排（和仓储同一个次序）。 */
export async function projectGroupRows(
  db: Db,
): Promise<Array<{ project_id: string; group_id: string }>> {
  const rows = await db.execute(
    sql`select project_id, group_id from project_groups order by project_id, group_id`,
  );
  return (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    project_id: row.project_id as string,
    group_id: row.group_id as string,
  }));
}

/** 建一个账号并登录，回账号行和能直接带上的 Cookie 头。 */
export interface Session {
  user: UserRecord;
  cookie: string;
}

export async function signIn(
  db: Db,
  app: TestApp["app"],
  username: string,
  isAdmin = false,
): Promise<Session> {
  // 账号已经在（同一个用例里又装了一个应用）就只登录，不重建：重建会撞上用户名的唯一索引。
  const users = createIdentityRepo().users;
  const user =
    (await users.findByUsername(db, username.toLowerCase())) ??
    (await seedUser(db, { username, password: PASSWORD, isAdmin }));
  const reply = await loginAs(app, username, PASSWORD);
  if (reply.status !== 200) throw new Error(`${username} 没登录上：${String(reply.status)}`);
  return { user, cookie: reply.cookie };
}

/** 测试自己用的真 git：读仓库、克隆仓库来断言。带的是调用方给的进程环境，不给就是开发者本机的配置。 */
export function git(args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: env === undefined ? undefined : { ...process.env, ...env },
        encoding: "utf8",
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`git ${args.join(" ")}：${stderr || err.message}`));
        else resolve(stdout);
      },
    );
  });
}

/** 一个像样的最新提交：编号、提交时间、标题。 */
export const CANNED_HEAD = `${"a".repeat(40)}
2026-11-27T00:00:00+00:00
Initial commit
`;

/**
 * 只会读最新提交的 git 桩：`log` 那条命令回 CANNED_HEAD，别的命令直接失败。
 * 记录是直接种进表的、没有仓库，但用例要看「详情回得出来」时用它，不必为一条记录去起真 git。
 */
export function cannedGit(): GitRunner {
  return {
    async run(args) {
      if (args.includes("log")) return { stdout: CANNED_HEAD, stderr: "" };
      throw new Error(`这个桩只会读最新提交，收到的是 git ${args.join(" ")}`);
    },
  };
}

/** 数调用次数的执行器，底下还是真的 git。清单那一条不许跑 git（规格 P-09），详情恰好一次（P-25）。 */
export function countingGit(real: GitRunner = createGitRunner()): GitRunner & { count(): number } {
  let calls = 0;
  return {
    count: () => calls,
    async run(args, cwd) {
      calls += 1;
      return real.run(args, cwd);
    },
  };
}

/**
 * 第 n 次（从 1 数）调用不跑、直接失败的执行器；之前的照常跑真的 git。
 * 这样每一步失败时，前面几步留下的东西是真的留在了盘上（规格 P-20 的「k 取遍每一步」）。
 */
export function failingGit(
  failAt: number,
  real: GitRunner = createGitRunner(),
): GitRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(args, cwd) {
      calls.push([...args]);
      if (calls.length === failAt) {
        throw Object.assign(new Error(`桩命令故意失败：git ${args.join(" ")}`), { stub: true });
      }
      return real.run(args, cwd);
    },
  };
}
