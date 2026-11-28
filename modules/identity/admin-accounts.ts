import { isForeignKeyViolation } from "@nexus/db";
import { createUser, USERNAME_PATTERN } from "./accounts.ts";
import {
  USER_DELETED,
  USER_DISABLED,
  USER_ENABLED,
  USER_PASSWORD_RESET,
  USER_UPDATED,
  type UserUpdatedChanges,
} from "./events.ts";
import { displayNameAccepted, normalizeDisplayName } from "./names.ts";
import { MAX_PASSWORD_LENGTH } from "./password.ts";
import type { UserRecord } from "./repo.ts";
import { isSelf, wouldLoseLastAdmin } from "./admin-guard.ts";
import type { IdentityContext, RequestTrace } from "./shared.ts";

/**
 * 管理员管账号的用例（人员规格 G-06 到 G-23，2026-11-28）：清单、建号、改号、重置口令、
 * 停用启用、删号。登录、会话、本人改密在 service.ts 和 accounts.ts。
 * 护栏的两道闸在 admin-guard.ts；全部写动作和事件在同一个事务里（规格 G-38）。
 */

export type CreateAccountRejection =
  | "invalid_username"
  | "display_name_invalid"
  | "username_taken"
  | "password_too_weak"
  | "password_too_long";

export type CreateAccountResult =
  | { kind: "ok"; user: UserRecord }
  | { kind: "rejected"; reason: CreateAccountRejection };

export type UpdateAccountResult =
  | { kind: "ok"; user: UserRecord }
  /** 显示名和管理员位都没变（规格 G-13）：回 200，不写库、不发事件。 */
  | { kind: "no_change"; user: UserRecord }
  /** 显示名不合规则（规格 G-12）。走路由时请求体那一层就拦下了，这里是同一道闸。 */
  | { kind: "invalid_display_name" }
  | { kind: "not_found" }
  | { kind: "self_change" }
  | { kind: "last_admin" };

export type ResetPasswordResult =
  | { kind: "ok"; revokedSessions: number }
  | { kind: "not_found" }
  | { kind: "self_change" }
  | { kind: "too_weak" };

export type SetDisabledResult =
  | { kind: "ok"; user: UserRecord }
  /** 已经是这个状态（2026-11-28 实现定下）：回 200，不写库、不发事件，同「没变就不动」（规格 G-13 的原则）。 */
  | { kind: "no_change"; user: UserRecord }
  | { kind: "not_found" }
  | { kind: "self_change" }
  | { kind: "last_admin" };

export type DeleteAccountResult =
  | { kind: "ok"; groupIds: string[] }
  | { kind: "not_found" }
  | { kind: "self_change" }
  | { kind: "last_admin" }
  | { kind: "has_projects" };

/** 人员清单：全部账号，停用的也在内，用户名升序（规格 G-06）。 */
export async function listAccounts(ctx: IdentityContext): Promise<UserRecord[]> {
  return ctx.deps.repo.users.listAll(ctx.deps.db);
}

/** 账号怎么回给调用方：恰好七个键，isDisabled 读停用时间有没有值（规格 G-06），时间转成带时区的 ISO 8601。 */
export function toAccount(record: UserRecord) {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    isAdmin: record.isAdmin,
    isDisabled: record.disabledAt !== null,
    createdAt: record.createdAt.toISOString(),
    passwordChangedAt: record.passwordChangedAt.toISOString(),
  };
}

/** 同事名录：全部启用的账号，用户名升序（规格 G-07）。 */
export async function listPeople(ctx: IdentityContext): Promise<UserRecord[]> {
  return ctx.deps.repo.users.listEnabled(ctx.deps.db);
}

/** 查一个账号；找不到回 undefined，由处理函数回 404（规格 G-01 的表）。 */
export async function getAccount(
  ctx: IdentityContext,
  userId: string,
): Promise<UserRecord | undefined> {
  return ctx.deps.repo.users.findById(ctx.deps.db, userId);
}

/**
 * 管理员建号（规格 G-08 到 G-11）。用户名的形状在路由那一层已经卡过一遍（契约里带着式子），
 * 用例再查一遍：命令行建号不走路由。显示名没给就是用户名，给了就按 G-12 收。
 */
export async function createAccount(
  ctx: IdentityContext,
  input: RequestTrace & {
    operatorId: string;
    username: string;
    password: string;
    displayName?: string | undefined;
    isAdmin: boolean;
  },
): Promise<CreateAccountResult> {
  if (!USERNAME_PATTERN.test(input.username)) {
    return { kind: "rejected", reason: "invalid_username" };
  }
  if (input.displayName !== undefined && !displayNameAccepted(input.displayName)) {
    return { kind: "rejected", reason: "display_name_invalid" };
  }
  const created = await createUser(ctx, {
    username: input.username,
    password: input.password,
    isAdmin: input.isAdmin,
    ...(input.displayName === undefined
      ? {}
      : { displayName: normalizeDisplayName(input.displayName) }),
    via: "admin",
    actorId: input.operatorId,
    traceId: input.traceId,
  });
  if (created.kind !== "ok") return { kind: "rejected", reason: created.reason };
  // 命令行的建号只回「我是谁」那四个键；管账号的路由要回七个键，把刚写进去的那一行读回来。
  const record = await ctx.deps.repo.users.findById(ctx.deps.db, created.user.id);
  if (!record) throw new Error("账号写进去了却读不回来（规格 G-08）");
  return { kind: "ok", user: record };
}

/**
 * 改显示名和管理员位（规格 G-13）。查的顺序：形状（事务外先卡）、找不找得到、值有没有真的变、
 * 会不会失去最后一个管理员（规格 G-20，在写库的事务里锁住再数）、动不动自己（规格 G-19）。
 * 两个 409 都命中时（最后一个管理员动自己），数量那道闸先说——「这次改动会让系统没有
 * 启用的管理员」是更具体的那句话，也让五个失败码在集成测试里都打得到（规格 G-04；
 * 2026-11-28 实现定下）。没变回 200 不写不发。
 */
export async function updateAccount(
  ctx: IdentityContext,
  input: RequestTrace & {
    operatorId: string;
    userId: string;
    displayName?: string | undefined;
    isAdmin?: boolean | undefined;
  },
): Promise<UpdateAccountResult> {
  const { deps } = ctx;
  if (input.displayName !== undefined && !displayNameAccepted(input.displayName)) {
    return { kind: "invalid_display_name" };
  }
  const at = ctx.now();
  const outcome = await deps.db.transaction(async (tx): Promise<UpdateAccountResult> => {
    // 行的当前值以事务里读到的那次为准（2026-11-29 审查 D-01）：事务外的快照在真库并发下会旧，
    // 事件的 from、降级判定和返回值都吃这次读。读到与写下之间再有并发提交的残余窗口接受——
    // 显示名类改动没有行锁可依托，属审计精度不是权限口子（模块卡有记）。
    const account = await deps.repo.users.findById(tx, input.userId);
    if (!account) return { kind: "not_found" };
    const displayName =
      input.displayName === undefined
        ? account.displayName
        : normalizeDisplayName(input.displayName);
    const isAdmin = input.isAdmin ?? account.isAdmin;
    const changes: UserUpdatedChanges = {};
    if (displayName !== account.displayName) {
      changes.displayName = { from: account.displayName, to: displayName };
    }
    if (isAdmin !== account.isAdmin) changes.isAdmin = { from: account.isAdmin, to: isAdmin };
    if (changes.displayName === undefined && changes.isAdmin === undefined) {
      return { kind: "no_change", user: account };
    }
    // 降级会减启用管理员数：先在事务里锁住全部启用的管理员行再数（规格 G-20）。
    if (isAdmin === false && account.isAdmin && account.disabledAt === null) {
      if ((await deps.repo.users.lockEnabledAdmins(tx)) <= 1) return { kind: "last_admin" };
    }
    // 降级自己才叫「动自己」（规格 G-19）；改自己的显示名、把自己升成管理员不在四个动作里。
    if (input.isAdmin === false && isSelf(input.operatorId, input.userId)) {
      return { kind: "self_change" };
    }
    if (changes.displayName !== undefined) {
      await deps.repo.users.setDisplayName(tx, account.id, displayName, at);
    }
    if (changes.isAdmin !== undefined) {
      await deps.repo.users.setIsAdmin(tx, account.id, isAdmin, at);
    }
    await ctx.emit(
      tx,
      USER_UPDATED,
      account.username,
      { userId: account.id, actorId: input.operatorId, changes },
      input.traceId,
    );
    return {
      kind: "ok",
      user: { ...account, displayName, isAdmin, updatedAt: at } satisfies UserRecord,
    };
  });
  return outcome;
}

/**
 * 重置口令（规格 G-14）。给**别的**账号重置：换新的 argon2id 散列，删光这个账号的会话，
 * 操作者自己的会话不动。给自己重置按「不动自己」拒绝：本人改口令的正路是 I-30，要验旧口令。
 */
export async function resetAccountPassword(
  ctx: IdentityContext,
  input: RequestTrace & { operatorId: string; userId: string; newPassword: string },
): Promise<ResetPasswordResult> {
  const { deps } = ctx;
  if (isSelf(input.operatorId, input.userId)) return { kind: "self_change" };
  if (input.newPassword.length < deps.passwordMinLength) return { kind: "too_weak" };
  // 请求体把口令卡在 128；走不到路由的调用（比如将来的脚本）放进更长的，将来登录不了。
  if (input.newPassword.length > MAX_PASSWORD_LENGTH) return { kind: "too_weak" };

  const passwordHash = await ctx.password.hash(input.newPassword);
  // 目标行的读取也在事务里（2026-11-29 审查 D-01 同款）：并发删号时不会给一个已经不在的账号发事件。
  return deps.db.transaction(async (tx): Promise<ResetPasswordResult> => {
    const account = await deps.repo.users.findById(tx, input.userId);
    if (!account) return { kind: "not_found" };
    await deps.repo.users.updatePasswordHash(tx, account.id, passwordHash, ctx.now());
    const count = await deps.repo.sessions.deleteAllForUser(tx, account.id);
    await ctx.emit(
      tx,
      USER_PASSWORD_RESET,
      account.username,
      { userId: account.id, actorId: input.operatorId, revokedSessions: count },
      input.traceId,
    );
    return { kind: "ok", revokedSessions: count };
  });
}

/**
 * 停用（规格 G-15）与启用（规格 G-16）。停用在同一个事务里删光这个账号的会话（同 I-29 的用例），
 * 加上事件；启用只清停用位，不恢复任何会话。停用不摘组（规格 G-17）：成员关系原样留着。
 * 护栏的先后同 updateAccount：数量那道闸先说（见那边的注释，2026-11-28）。
 */
export async function setAccountDisabled(
  ctx: IdentityContext,
  input: RequestTrace & { operatorId: string; userId: string; disabled: boolean },
): Promise<SetDisabledResult> {
  const { deps } = ctx;
  const at = ctx.now();
  // 停用和启用走同一个事务，目标行以事务里读到的那次为准（同 updateAccount，2026-11-29 审查 D-01）。
  return deps.db.transaction(async (tx): Promise<SetDisabledResult> => {
    const account = await deps.repo.users.findById(tx, input.userId);
    if (!account) return { kind: "not_found" };
    if ((account.disabledAt !== null) === input.disabled) {
      return { kind: "no_change", user: account };
    }
    if (input.disabled) {
      if (await wouldLoseLastAdmin(deps.repo, tx, account)) return { kind: "last_admin" };
      if (isSelf(input.operatorId, input.userId)) return { kind: "self_change" };
      await deps.repo.users.setDisabledAt(tx, account.id, at, at);
      await deps.repo.sessions.deleteAllForUser(tx, account.id);
      await ctx.emit(
        tx,
        USER_DISABLED,
        account.username,
        { userId: account.id, actorId: input.operatorId },
        input.traceId,
      );
      return { kind: "ok", user: { ...account, disabledAt: at, updatedAt: at } };
    }
    await deps.repo.users.setDisabledAt(tx, account.id, null, at);
    await ctx.emit(
      tx,
      USER_ENABLED,
      account.username,
      { userId: account.id, actorId: input.operatorId },
      input.traceId,
    );
    return {
      kind: "ok",
      user: { ...account, disabledAt: null, updatedAt: at } satisfies UserRecord,
    };
  });
}

/**
 * 删号（规格 G-21 到 G-23）。不先查后删：直接删，库因为 `projects.created_by_id` 的引用约束拒绝
 * 就翻译成 `identity_user_has_projects`——没有「查完到删完之间又建了一个工程」的口子。
 * 会话和组成员关系随外键级联；事件里带上删前他在哪些组（规格 G-22）。
 * 护栏的先后同 updateAccount（见那边的注释，2026-11-28）。
 */
export async function deleteAccount(
  ctx: IdentityContext,
  input: RequestTrace & { operatorId: string; userId: string },
): Promise<DeleteAccountResult> {
  const { deps } = ctx;

  try {
    const outcome = await deps.db.transaction(async (tx): Promise<DeleteAccountResult> => {
      // 目标行以事务里读到的那次为准（同 updateAccount，2026-11-29 审查 D-01）。
      const account = await deps.repo.users.findById(tx, input.userId);
      if (!account) return { kind: "not_found" };
      // 降级、停用、删号三道闸共用一道（规格 G-18、G-20）。
      if (await wouldLoseLastAdmin(deps.repo, tx, account)) return { kind: "last_admin" };
      if (isSelf(input.operatorId, input.userId)) return { kind: "self_change" };
      // 删之前先读组：行删了成员关系就没了，事件里要带上（规格 G-22）。
      const groups = await deps.repo.groups.groupIdsForUser(tx, account.id);
      await deps.repo.users.delete(tx, account.id);
      await ctx.emit(
        tx,
        USER_DELETED,
        account.username,
        { userId: account.id, actorId: input.operatorId, groupIds: groups },
        input.traceId,
      );
      return { kind: "ok", groupIds: groups };
    });
    return outcome;
  } catch (err) {
    // 建过工程的账号删不掉（规格 G-21）：库拒绝是唯一的保证，两个错误码都要认（AGENTS.md 的坑）。
    if (isForeignKeyViolation(err)) return { kind: "has_projects" };
    throw err;
  }
}
