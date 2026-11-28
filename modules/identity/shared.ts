import type { CurrentUser } from "@nexus/contracts";
import type { Db, Tx } from "@nexus/db";
import type { EventLog, EventRecord } from "@nexus/event-log";
import type { ZodType } from "zod";
import {
  LOGIN_FAILED,
  LOGIN_SUCCEEDED,
  LOGOUT,
  PASSWORD_CHANGED,
  USER_CREATED,
  USER_DELETED,
  USER_DISABLED,
  USER_ENABLED,
  USER_PASSWORD_RESET,
  USER_UPDATED,
  loginFailedPayload,
  loginSucceededPayload,
  logoutPayload,
  passwordChangedPayload,
  userCreatedPayload,
  userDeletedPayload,
  userDisabledPayload,
  userEnabledPayload,
  userPasswordResetPayload,
  userUpdatedPayload,
} from "./events.ts";
import {
  GROUP_CREATED,
  GROUP_DELETED,
  GROUP_MEMBERS_CHANGED,
  GROUP_RENAMED,
  groupCreatedPayload,
  groupDeletedPayload,
  groupMembersChangedPayload,
  groupRenamedPayload,
} from "./group-events.ts";
import { lockedSeconds, lockoutKey, nextFailure } from "./lockout.ts";
import { argon2PasswordHasher, type PasswordHasher } from "./password.ts";
import type { IdentityRepo, SessionRecord, UserRecord } from "./repo.ts";
import { hashToken } from "./tokens.ts";

/**
 * 几个用例文件共用的东西：依赖的形状、结果的形状、几个内部帮手。
 * 结果的形状也放在这里，是为了让 service.ts 和各用例文件不必回头引用对方（模块依赖必须无环）。
 */

export interface IdentityServiceDeps {
  db: Db;
  repo: IdentityRepo;
  eventLog: Pick<EventLog, "emit">;
  /** 配置项 PASSWORD_MIN_LENGTH，由应用读了环境变量传进来。 */
  passwordMinLength: number;
  /** 当前时间。由应用或测试传入，模块不直接读系统时钟。 */
  now?: () => Date;
  /** 缺省是 argon2id。测试换成计数桩，验「恰好做一次校验」（规格 I-11）。 */
  password?: PasswordHasher;
}

/** 每个请求都带着的两样：从哪来，以及为了对上日志的请求号。 */
export interface RequestTrace {
  /** 来源地址。只写进事件，不参与任何判断。 */
  ip: string;
  /** 该请求的请求号，原样写进事件的 traceId。脚本发的没有请求号，可以不带。 */
  traceId?: string | undefined;
}

/** 一条有效的会话。renewed 为真表示这次请求把会话续了期，响应里要重发 cookie（规格 I-22）。 */
export interface AuthenticatedSession {
  user: CurrentUser;
  /**
   * 这个人所属的用户组编号（规格 G-34，2026-11-28）。访问闸把它放进请求上下文，工程模块建工程、
   * 判可见性用；对外的 `me` 不带它（规格 G-34）。组变了下一个请求就生效：每个请求都重新认证。
   */
  groupIds: string[];
  renewed: boolean;
}

export type LoginResult =
  | { kind: "ok"; user: CurrentUser; token: string; expiresAt: Date }
  /** 用户名不存在、账号没有口令、口令不对：对调用方是同一个结果（规格 I-10）。 */
  | { kind: "invalid" }
  | { kind: "locked"; retryAfterSeconds: number }
  | { kind: "disabled" };

export type ChangePasswordResult =
  | { kind: "ok"; token: string; expiresAt: Date; revokedSessions: number }
  /** 拿来改密的会话已经不在了，比如同一个浏览器的另一个标签页刚退出。 */
  | { kind: "no_session" }
  | { kind: "locked"; retryAfterSeconds: number }
  | { kind: "current_password_wrong" }
  | { kind: "too_weak" }
  | { kind: "reused" };

export type CreateUserRejection =
  | "invalid_username"
  | "username_taken"
  | "password_too_weak"
  | "password_too_long";

export type CreateUserResult =
  | { kind: "ok"; user: CurrentUser }
  | { kind: "rejected"; reason: CreateUserRejection };

export interface IdentityContext {
  deps: IdentityServiceDeps;
  now(): Date;
  password: PasswordHasher;
  /** 发一条事件。给了事务，它就和同一个事务里的业务写入一起成、一起败（规格 I-41）。 */
  emit(
    ex: Tx | undefined,
    type: string,
    subject: string,
    payload: unknown,
    traceId: string | undefined,
  ): Promise<EventRecord>;
  /** 这个用户名没在锁就回 undefined；在锁就回还要等多少秒（规格 I-14）。 */
  lockSeconds(username: string): Promise<number | undefined>;
  /** 令牌换来一条还有效的会话和它的账号。令牌对不上、会话过期、账号没了，都回 undefined。 */
  liveSession(token: string): Promise<{ session: SessionRecord; account: UserRecord } | undefined>;
  /**
   * 给这个用户名记一次失败，顺手删掉全表窗口外的记录（规格 I-12）。
   * onRecorded 在同一个事务里跑：登录用它把事件和这次写入绑在一起。
   */
  recordFailure(username: string, at: Date, onRecorded?: (tx: Tx) => Promise<void>): Promise<void>;
}

/**
 * 发事件之前先过形状（规格 I-40）：payload 里多一个键就当场抛，不让夹带口令、散列、盐的事件写进库。
 * 形状是严格对象，多出来的键过不了。认不出的类型不拦：别处往后加了事件、忘了登记形状，不该把业务拦下。
 */
const PAYLOAD_SCHEMAS: Record<string, ZodType> = {
  [LOGIN_SUCCEEDED]: loginSucceededPayload,
  [LOGIN_FAILED]: loginFailedPayload,
  [LOGOUT]: logoutPayload,
  [PASSWORD_CHANGED]: passwordChangedPayload,
  [USER_CREATED]: userCreatedPayload,
  [USER_UPDATED]: userUpdatedPayload,
  [USER_PASSWORD_RESET]: userPasswordResetPayload,
  [USER_DISABLED]: userDisabledPayload,
  [USER_ENABLED]: userEnabledPayload,
  [USER_DELETED]: userDeletedPayload,
  [GROUP_CREATED]: groupCreatedPayload,
  [GROUP_RENAMED]: groupRenamedPayload,
  [GROUP_MEMBERS_CHANGED]: groupMembersChangedPayload,
  [GROUP_DELETED]: groupDeletedPayload,
};

export function toUser(record: UserRecord): CurrentUser {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    isAdmin: record.isAdmin,
  };
}

export function createIdentityContext(deps: IdentityServiceDeps): IdentityContext {
  const now = deps.now ?? ((): Date => new Date());
  const password = deps.password ?? argon2PasswordHasher;

  const liveSession: IdentityContext["liveSession"] = async (token) => {
    const session = await deps.repo.sessions.findByTokenHash(deps.db, await hashToken(token));
    if (!session || session.expiresAt.getTime() <= now().getTime()) return undefined;
    const account = await deps.repo.users.findById(deps.db, session.userId);
    return account === undefined ? undefined : { session, account };
  };

  return {
    deps,
    now,
    password,
    // 写成 async：形状不对时拒绝，而不是同步抛。调用方一律 await，两种写法到了那里都一样，但异步接口不同步抛更说得通。
    async emit(ex, type, subject, payload, traceId) {
      const schema = PAYLOAD_SCHEMAS[type];
      if (schema !== undefined && !schema.safeParse(payload).success) {
        throw new Error(
          `事件 ${type} 的 payload 不合形状：${JSON.stringify(Object.keys(payload as object))}`,
        );
      }
      return deps.eventLog.emit(
        {
          type,
          source: "identity",
          subject,
          payload,
          occurredAt: now().toISOString(),
          ...(traceId === undefined ? {} : { traceId }),
        },
        ex,
      );
    },
    async lockSeconds(username) {
      return lockedSeconds(await deps.repo.failures.get(deps.db, lockoutKey(username)), now());
    },
    liveSession,
    async recordFailure(username, at, onRecorded) {
      const key = lockoutKey(username);
      await deps.db.transaction(async (tx) => {
        // 先锁住这一行再读、再写：并发下「读、加一、写」才不会丢数（见 repo.ts 的 lock）。
        const next = nextFailure(await deps.repo.failures.lock(tx, key, at), key, at);
        await deps.repo.failures.put(tx, next);
        await deps.repo.failures.prune(tx, key, at);
        await onRecorded?.(tx);
      });
    },
  };
}
