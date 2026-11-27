import { createDatabase, runMigrations, type DatabaseHandle, type Db } from "@nexus/db";
import {
  argon2PasswordHasher,
  createIdentityRepo,
  type NewUser,
  type UserRecord,
} from "@nexus/identity";
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { pino, type Logger } from "pino";
import { composeApp, type ComposeInput, type Composed } from "../compose.ts";
import { migrationsFolder } from "../database.ts";

/**
 * 集成测试的公用件：内存库加真迁移、照启动时一模一样的接线装出来的应用、可以拨的时钟，
 * 外加几个种数据和打请求的小工具。只有 *.integration.test.ts 会 import 它。
 */

/** 开发时页面服务器的地址：页面在 4261，接口经它转给后端，所以请求的 Host 就是它。 */
export const PAGE_ORIGIN = "http://127.0.0.1:4261";
export const DAY_MS = 24 * 60 * 60 * 1000;
export const T0 = new Date("2026-11-27T00:00:00.000Z");

export interface Clock {
  now(): Date;
  tick(ms: number): void;
}

export function clock(start: Date = T0): Clock {
  const current = new Date(start.getTime());
  return {
    now: () => new Date(current.getTime()),
    tick: (ms) => {
      current.setTime(current.getTime() + ms);
    },
  };
}

export interface MemoryLog {
  log: Logger;
  /** 到此刻为止写下的每一行。 */
  entries(): Record<string, unknown>[];
}

export function memoryLog(): MemoryLog {
  const lines: string[] = [];
  const log = pino({ level: "debug" }, { write: (line: string) => void lines.push(line) });
  return { log, entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

/** 一个空的内存库，迁移已经跑完。调用方负责 close。 */
export async function createTestDatabase(): Promise<DatabaseHandle> {
  const database = await createDatabase({});
  await runMigrations(database, migrationsFolder);
  return database;
}

export type TestApp = Composed & { clock: Clock; log: MemoryLog };

/** 照启动时那份接线装一个应用：真迁移、真路由、真 cookie、真验证器。 */
export async function boot(options: {
  db: Db;
  clock?: Clock;
  log?: MemoryLog;
  publicOrigin?: string | undefined;
  passwordMinLength?: number;
  repo?: IdentityRepoInput;
}): Promise<TestApp> {
  const time = options.clock ?? clock();
  const memory = options.log ?? memoryLog();
  const composed = await composeApp({
    db: options.db,
    log: memory.log,
    version: "9.9.9",
    runtime: "vtest",
    publicOrigin: options.publicOrigin,
    passwordMinLength: options.passwordMinLength ?? 8,
    now: time.now,
    ...(options.repo === undefined ? {} : { repo: options.repo }),
  });
  return { ...composed, clock: time, log: memory };
}
type IdentityRepoInput = ComposeInput["repo"];

/** 直接往表里放一个账号，不走用例：要什么样的行就放什么样的行。 */
export async function seedUser(
  db: Db,
  input: {
    username: string;
    password?: string;
    /** 给了就原样存：没有口令给 null，旧系统的散列给十六进制串。 */
    passwordHash?: string | null;
    isAdmin?: boolean;
    disabledAt?: Date | null;
  },
): Promise<UserRecord> {
  const at = new Date();
  const row: NewUser = {
    id: randomUUID(),
    username: input.username,
    displayName: input.username,
    passwordHash:
      input.passwordHash !== undefined
        ? input.passwordHash
        : await argon2PasswordHasher.hash(input.password ?? "default-password"),
    isAdmin: input.isAdmin ?? false,
    disabledAt: input.disabledAt ?? null,
    passwordChangedAt: at,
    createdAt: at,
    updatedAt: at,
  };
  return createIdentityRepo().users.insert(db, row);
}

/**
 * 直接查表读出来的时间列是 Postgres 的文本（比如 2026-11-27 00:00:00+00），不是 Date。
 * 断言之前先转成 Date，免得每个用例各转一遍。
 */
type RawRow = Record<string, unknown>;
const toDate = (value: unknown): Date => new Date(value as string);
const toNullableDate = (value: unknown): Date | null => (value === null ? null : toDate(value));

export interface EventRow {
  type: string;
  source: string;
  subject: string | null;
  payload: Record<string, unknown>;
  trace_id: string | null;
  occurred_at: Date;
}

export async function identityEvents(db: Db, type?: string): Promise<EventRow[]> {
  const condition: SQL[] = [sql`source = 'identity'`];
  if (type !== undefined) condition.push(sql`type = ${type}`);
  const rows = await db.execute(
    sql`select type, source, subject, payload, trace_id, occurred_at from events where ${sql.join(condition, sql` and `)} order by id`,
  );
  return (rows.rows as RawRow[]).map((row) => ({
    type: row.type as string,
    source: row.source as string,
    subject: (row.subject ?? null) as string | null,
    payload: row.payload as Record<string, unknown>,
    trace_id: (row.trace_id ?? null) as string | null,
    occurred_at: toDate(row.occurred_at),
  }));
}

export interface FailureRow {
  username: string;
  failure_count: number;
  window_started_at: Date;
  locked_until: Date | null;
}

export async function failureRows(db: Db): Promise<FailureRow[]> {
  const rows = await db.execute(
    sql`select username, failure_count, window_started_at, locked_until from identity_login_failures order by username`,
  );
  return (rows.rows as RawRow[]).map((row) => ({
    username: row.username as string,
    failure_count: row.failure_count as number,
    window_started_at: toDate(row.window_started_at),
    locked_until: toNullableDate(row.locked_until),
  }));
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

export async function sessionRows(db: Db): Promise<SessionRow[]> {
  const rows = await db.execute(
    sql`select token_hash, user_id, created_at, last_seen_at, expires_at from identity_sessions order by created_at, token_hash`,
  );
  return (rows.rows as RawRow[]).map((row) => ({
    token_hash: row.token_hash as string,
    user_id: row.user_id as string,
    created_at: toDate(row.created_at),
    last_seen_at: toDate(row.last_seen_at),
    expires_at: toDate(row.expires_at),
  }));
}

/** 把身份模块的表和它发的事件清空，下一个用例从干净的数据开始。 */
export async function clearIdentity(db: Db): Promise<void> {
  await db.execute(sql`delete from identity_sessions`);
  await db.execute(sql`delete from identity_login_failures`);
  await db.execute(sql`delete from identity_users`);
  await db.execute(sql`delete from events where source = 'identity'`);
}

export async function userRows(db: Db): Promise<Array<Record<string, unknown>>> {
  const rows = await db.execute(sql`select * from identity_users order by username`);
  return rows.rows as Array<Record<string, unknown>>;
}

export interface CallOptions {
  method?: string;
  /** Cookie 头的值，比如 nexus_session=…。 */
  cookie?: string;
  headers?: Record<string, string>;
  /** 给了就当 JSON 发。 */
  body?: unknown;
  /** Origin 头的值；要试 `null` 就传字符串 "null"。 */
  origin?: string;
  requestId?: string;
}

export interface FailureBody {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}

export interface Reply {
  status: number;
  headers: Headers;
  body: unknown;
  /** 失败时的正文。 */
  error: FailureBody | undefined;
  /** 全部 Set-Cookie，原样。 */
  setCookies: string[];
  requestId: string;
}

/**
 * 打一次接口。Host 一律带上页面开发服务器的地址：app.request() 造出来的请求没有 Host
 * （真服务里它由连接那一层加），而来源校验要拿它拼出请求自己的地址。
 */
export async function call(
  app: Composed["app"],
  path: string,
  options: CallOptions = {},
): Promise<Reply> {
  const headers: Record<string, string> = { host: new URL(PAGE_ORIGIN).host, ...options.headers };
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  if (options.requestId !== undefined) headers["x-request-id"] = options.requestId;
  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.body !== undefined) {
    headers["content-type"] ??= "application/json";
    init.body = JSON.stringify(options.body);
  }
  const res = await app.request(path, init);
  const text = await res.text();
  const body = text === "" ? undefined : (JSON.parse(text) as unknown);
  const error = (body as { error?: FailureBody } | undefined)?.error;
  return {
    status: res.status,
    headers: res.headers,
    body,
    error,
    setCookies: res.headers.getSetCookie(),
    requestId: res.headers.get("x-request-id") ?? "",
  };
}

/** 从 Set-Cookie 里取出「名字=值」那一段，当成下次要带的 Cookie 头。 */
export function cookieHeader(setCookie: string): string {
  return setCookie.split(";")[0]?.trim() ?? "";
}

export function cookieValue(setCookie: string): string {
  return cookieHeader(setCookie).split("=").slice(1).join("=");
}

/** 登录一次，回应当和可以直接带上的 Cookie 头。 */
export async function loginAs(
  app: Composed["app"],
  username: string,
  password: string,
  headers: Record<string, string> = {},
): Promise<Reply & { cookie: string }> {
  const reply = await call(app, AUTH.login, {
    method: "POST",
    body: { username, password },
    headers,
  });
  const first = reply.setCookies[0];
  return { ...reply, cookie: first === undefined ? "" : cookieHeader(first) };
}

export const AUTH = {
  me: "/api/v1/auth/me",
  login: "/api/v1/auth/login",
  logout: "/api/v1/auth/logout",
  password: "/api/v1/auth/password",
  info: "/api/v1/system/info",
  health: "/api/v1/system/health",
  doc: "/api/v1/doc",
} as const;
