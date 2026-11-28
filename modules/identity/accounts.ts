import { isUniqueViolation, type Tx } from "@nexus/db";
import { randomUUID } from "node:crypto";
import { PASSWORD_CHANGED, USER_CREATED } from "./events.ts";
import { USERNAME_PATTERN } from "./names.ts";
import { MAX_PASSWORD_LENGTH } from "./password.ts";
import type { UserRecord } from "./repo.ts";
import {
  type ChangePasswordResult,
  type CreateUserResult,
  type IdentityContext,
  type RequestTrace,
  toUser,
} from "./shared.ts";
import { hashToken, newSessionToken, SESSION_TTL_MS } from "./tokens.ts";

/**
 * 账号自己的三件事：本人改密、建号、停用。登录和会话在 service.ts。
 * 管理员管账号的用例在 admin-accounts.ts，建号从这里的 createUser 走（同一个事务、同一个事件形状）。
 */

// 用户名的规则住在 names.ts（纯规则，路由声明和用例校验共用）；这里转出口给老的引用方。
export { USERNAME_PATTERN };

/**
 * 本人改密（规格 I-30 到 I-33）。查的顺序：会话、锁定、新口令长度、旧口令、新旧相同。
 * 成功后换成新的散列，吊销这个账号的其它会话，当前会话换一枚新令牌。
 */
export async function changePassword(
  ctx: IdentityContext,
  input: RequestTrace & { token: string; currentPassword: string; newPassword: string },
): Promise<ChangePasswordResult> {
  const { deps } = ctx;
  const at = ctx.now();
  const live = await ctx.liveSession(input.token);
  const account = live?.account;
  // 访问闸刚验过会话，这里找不到只会是两步之间会话没了。按没登录处理，由处理函数回 401。
  if (!live || !account || account.disabledAt !== null) return { kind: "no_session" };

  // 这个用户名处于锁定时，改密同样回 429（规格 I-31）。
  const retryAfterSeconds = await ctx.lockSeconds(account.username);
  if (retryAfterSeconds !== undefined) return { kind: "locked", retryAfterSeconds };

  // 长度查在旧口令之前（规格 I-32）：太短的新口令不验旧口令，也不记失败。只查长度，不查字符种类。
  if (input.newPassword.length < deps.passwordMinLength) return { kind: "too_weak" };

  const currentOk = await ctx.password.verify(account.passwordHash, input.currentPassword);
  if (!currentOk) {
    // 旧口令不对，像登录失败一样记一次失败（规格 I-31）。这一片不为它发事件。
    await ctx.recordFailure(account.username, at);
    return { kind: "current_password_wrong" };
  }
  // 走到这里旧口令已经验过，所以「新口令等于交上来的旧口令」就是「新旧相同」（规格 I-33）。
  if (input.newPassword === input.currentPassword) return { kind: "reused" };

  const passwordHash = await ctx.password.hash(input.newPassword);
  const token = newSessionToken();
  const expiresAt = new Date(at.getTime() + SESSION_TTL_MS);
  const tokenHash = await hashToken(token);
  const revokedSessions = await deps.db.transaction(async (tx) => {
    await deps.repo.users.updatePasswordHash(tx, account.id, passwordHash, at);
    const count = await deps.repo.sessions.deleteOthers(tx, account.id, live.session.id);
    await deps.repo.sessions.rotate(tx, live.session.id, tokenHash, expiresAt, at);
    await ctx.emit(
      tx,
      PASSWORD_CHANGED,
      account.username,
      { userId: account.id, ip: input.ip, revokedSessions: count },
      input.traceId,
    );
    return count;
  });
  // 改密成功不清失败记录（规格 I-31）。
  return { kind: "ok", token, expiresAt, revokedSessions };
}

/**
 * 建账号（规格 I-46、I-48；管理员建号同走这里，规格 G-08 到 G-11）。建出来的账号未停用，
 * 显示名没给就等于用户名。四种拒绝都不写库，理由交给调用方去说。
 * via 是 admin 时必须带操作者的编号（规格事件表）；命令行没有请求号，管理员建的带。
 */
export async function createUser(
  ctx: IdentityContext,
  input: {
    username: string;
    password: string;
    isAdmin: boolean;
    /** 已经按显示名的规则收好的值（规格 G-12）；没给就是用户名。 */
    displayName?: string | undefined;
    via?: "cli" | "admin";
    actorId?: string | undefined;
    traceId?: string | undefined;
  },
): Promise<CreateUserResult> {
  const { deps } = ctx;
  if (!USERNAME_PATTERN.test(input.username)) {
    return { kind: "rejected", reason: "invalid_username" };
  }
  if (input.password.length < deps.passwordMinLength) {
    return { kind: "rejected", reason: "password_too_weak" };
  }
  // 登录和改密的请求体都把口令卡在 128；建号时放进去更长的，将来登录不了。
  if (input.password.length > MAX_PASSWORD_LENGTH) {
    return { kind: "rejected", reason: "password_too_long" };
  }
  // 查重不分大小写：只差大小写的两个用户名，锁定时是同一把键，登录时找的也是同一行。
  const taken = await deps.repo.users.findByUsername(deps.db, input.username.toLowerCase());
  if (taken) return { kind: "rejected", reason: "username_taken" };

  const passwordHash = await ctx.password.hash(input.password);
  const at = ctx.now();
  const via = input.via ?? "cli";
  const insert = async (tx: Tx): Promise<UserRecord> => {
    const row = await deps.repo.users.insert(tx, {
      id: randomUUID(),
      username: input.username,
      displayName: input.displayName ?? input.username,
      passwordHash,
      isAdmin: input.isAdmin,
      disabledAt: null,
      passwordChangedAt: at,
      createdAt: at,
      updatedAt: at,
    });
    await ctx.emit(
      tx,
      USER_CREATED,
      input.username,
      {
        userId: row.id,
        isAdmin: input.isAdmin,
        via,
        ...(via === "admin" && input.actorId !== undefined ? { actorId: input.actorId } : {}),
      },
      input.traceId,
    );
    return row;
  };
  try {
    const row = await deps.db.transaction((tx) => insert(tx));
    return { kind: "ok", user: toUser(row) };
  } catch (err) {
    // 两个只差大小写的用户名同时来建，上面查重那一步两边都查不到，靠库里的唯一索引拦下（规格 I-34）。
    if (isUniqueViolation(err)) return { kind: "rejected", reason: "username_taken" };
    throw err;
  }
}

/**
 * 置停用位（规格 I-29）。停用的时候在同一个事务里删光这个账号的会话；
 * 重新启用不会让旧 cookie 复活，因为那些会话行已经不在了（旧系统重新启用会复活未过期的旧票）。
 */
export async function setDisabled(
  ctx: IdentityContext,
  userId: string,
  disabled: boolean,
): Promise<void> {
  const { deps } = ctx;
  const at = ctx.now();
  await deps.db.transaction(async (tx) => {
    await deps.repo.users.setDisabledAt(tx, userId, disabled ? at : null, at);
    await deps.repo.sessions.deleteAllForUser(tx, userId);
  });
}

// 「违反唯一约束」的判定住在 @nexus/db（isUniqueViolation）：drizzle 把数据库的错包了一层，
// 错误码在 cause 上，只看最外层会漏判（2026-11-28，工程模块实弹后迁到公共包，身份模块同款换掉）。
