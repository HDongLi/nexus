import { randomUUID } from "node:crypto";
import { LOGIN_FAILED, LOGIN_SUCCEEDED, LOGOUT } from "./events.ts";
import { lockoutKey } from "./lockout.ts";
import { changePassword, createUser, setDisabled } from "./accounts.ts";
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  listPeople,
  resetAccountPassword,
  setAccountDisabled,
  updateAccount,
  type CreateAccountResult,
  type DeleteAccountResult,
  type ResetPasswordResult,
  type SetDisabledResult,
  type UpdateAccountResult,
} from "./admin-accounts.ts";
import {
  createGroup,
  deleteGroup,
  getGroup,
  groupExists,
  listGroups,
  renameGroup,
  replaceGroupMembers,
  type CreateGroupResult,
  type DeleteGroupResult,
  type GroupWithMembers,
  type RenameGroupResult,
  type ReplaceMembersResult,
} from "./groups.ts";
import { hashToken, newSessionToken, SESSION_RENEW_AFTER_MS, SESSION_TTL_MS } from "./tokens.ts";
import {
  createIdentityContext,
  type AuthenticatedSession,
  type ChangePasswordResult,
  type CreateUserResult,
  type IdentityContext,
  type IdentityServiceDeps,
  type LoginResult,
  type RequestTrace,
  toUser,
} from "./shared.ts";
import type { UserRecord } from "./repo.ts";

/**
 * 身份模块的用例门面：登录、会话在这里，本人改密、命令行建号、停用在 accounts.ts，
 * 管理员管账号在 admin-accounts.ts，用户组在 groups.ts。业务规则只住在那几个文件里；
 * 依赖全部由创建函数显式传进来，模块不自己去拿。
 * 这一行到 300 行是上限，超了就拆，不调限额（任务书 P11）。
 */
export interface IdentityService {
  login(input: RequestTrace & { username: string; password: string }): Promise<LoginResult>;
  /**
   * 访问闸用：令牌换成当前用户和他所属的用户组编号（规格 G-34）。
   * 令牌找不到会话、会话已过期、账号已停用，都回 undefined。
   * 剩余有效期不足 15 天时续期，renewed 为真（规格 I-22）。
   */
  authenticate(token: string): Promise<AuthenticatedSession | undefined>;
  logout(input: RequestTrace & { token: string }): Promise<void>;
  changePassword(
    input: RequestTrace & { token: string; currentPassword: string; newPassword: string },
  ): Promise<ChangePasswordResult>;
  /** 命令行建号（脚本用）。管理员建号走 createAccount，同一个底层（规格 G-08）。 */
  createUser(input: {
    username: string;
    password: string;
    isAdmin: boolean;
  }): Promise<CreateUserResult>;
  /** 置停用位，不发事件。管账号的停用走 setAccountDisabled（规格 G-15）；I-29 的会话吊销两条都做。 */
  setDisabled(userId: string, disabled: boolean): Promise<void>;

  /** 人员清单：全部账号，停用的也在内（规格 G-06）。 */
  listAccounts(): Promise<UserRecord[]>;
  /** 同事名录：全部启用的账号（规格 G-07）。 */
  listPeople(): Promise<UserRecord[]>;
  getAccount(userId: string): Promise<UserRecord | undefined>;
  createAccount(
    input: RequestTrace & {
      operatorId: string;
      username: string;
      password: string;
      displayName?: string | undefined;
      isAdmin: boolean;
    },
  ): Promise<CreateAccountResult>;
  updateAccount(
    input: RequestTrace & {
      operatorId: string;
      userId: string;
      displayName?: string | undefined;
      isAdmin?: boolean | undefined;
    },
  ): Promise<UpdateAccountResult>;
  resetAccountPassword(
    input: RequestTrace & { operatorId: string; userId: string; newPassword: string },
  ): Promise<ResetPasswordResult>;
  setAccountDisabled(
    input: RequestTrace & { operatorId: string; userId: string; disabled: boolean },
  ): Promise<SetDisabledResult>;
  deleteAccount(
    input: RequestTrace & { operatorId: string; userId: string },
  ): Promise<DeleteAccountResult>;

  listGroups(): Promise<GroupWithMembers[]>;
  getGroup(groupId: string): Promise<GroupWithMembers | undefined>;
  /** 「用户组在不在」：身份模块对工程模块的唯一公开查询（规格 G-31）。 */
  groupExists(groupId: string): Promise<boolean>;
  createGroup(
    input: RequestTrace & { operatorId: string; name: string; memberIds?: string[] | undefined },
  ): Promise<CreateGroupResult>;
  renameGroup(
    input: RequestTrace & { operatorId: string; groupId: string; name: string },
  ): Promise<RenameGroupResult>;
  replaceGroupMembers(
    input: RequestTrace & { operatorId: string; groupId: string; userIds: string[] },
  ): Promise<ReplaceMembersResult>;
  deleteGroup(
    input: RequestTrace & { operatorId: string; groupId: string },
  ): Promise<DeleteGroupResult>;
}

export function createIdentityService(deps: IdentityServiceDeps): IdentityService {
  const ctx = createIdentityContext(deps);
  return {
    login: (input) => login(ctx, input),
    authenticate: (token) => authenticate(ctx, token),
    logout: (input) => logout(ctx, input),
    changePassword: (input) => changePassword(ctx, input),
    createUser: (input) => createUser(ctx, input),
    setDisabled: (userId, disabled) => setDisabled(ctx, userId, disabled),
    listAccounts: () => listAccounts(ctx),
    listPeople: () => listPeople(ctx),
    getAccount: (userId) => getAccount(ctx, userId),
    createAccount: (input) => createAccount(ctx, input),
    updateAccount: (input) => updateAccount(ctx, input),
    resetAccountPassword: (input) => resetAccountPassword(ctx, input),
    setAccountDisabled: (input) => setAccountDisabled(ctx, input),
    deleteAccount: (input) => deleteAccount(ctx, input),
    listGroups: () => listGroups(ctx),
    getGroup: (groupId) => getGroup(ctx, groupId),
    groupExists: (groupId) => groupExists(ctx, groupId),
    createGroup: (input) => createGroup(ctx, input),
    renameGroup: (input) => renameGroup(ctx, input),
    replaceGroupMembers: (input) => replaceGroupMembers(ctx, input),
    deleteGroup: (input) => deleteGroup(ctx, input),
  };
}

/**
 * 登录。查的顺序：形状（在路由那一层）、锁定、口令、停用（规格 I-09）。
 */
async function login(
  ctx: IdentityContext,
  input: RequestTrace & { username: string; password: string },
): Promise<LoginResult> {
  const { deps } = ctx;
  const at = ctx.now();

  // 在锁就不验口令：口令对了也进不来，也不再记失败（规格 I-14）。
  const retryAfterSeconds = await ctx.lockSeconds(input.username);
  if (retryAfterSeconds !== undefined) {
    await ctx.emit(
      undefined,
      LOGIN_FAILED,
      input.username,
      { ip: input.ip, reason: "locked_out" },
      input.traceId,
    );
    return { kind: "locked", retryAfterSeconds };
  }

  // 用户名不存在、账号没有口令、口令不对，走的是同一句：都恰好做一次校验，回同一个结果（规格 I-10、I-11）。
  const account = await deps.repo.users.findByUsername(deps.db, lockoutKey(input.username));
  const passwordOk = await ctx.password.verify(account?.passwordHash ?? null, input.password);
  if (account === undefined || !passwordOk) {
    await ctx.recordFailure(input.username, at, async (tx) => {
      await ctx.emit(
        tx,
        LOGIN_FAILED,
        input.username,
        { ip: input.ip, reason: "invalid_credentials" },
        input.traceId,
      );
    });
    return { kind: "invalid" };
  }

  // 停用查在口令之后（规格 I-09）：口令不对就回「不对」，不替人确认口令猜对了。
  if (account.disabledAt !== null) {
    await ctx.emit(
      undefined,
      LOGIN_FAILED,
      input.username,
      { ip: input.ip, reason: "account_disabled" },
      input.traceId,
    );
    return { kind: "disabled" };
  }

  const token = newSessionToken();
  const expiresAt = new Date(at.getTime() + SESSION_TTL_MS);
  await deps.db.transaction(async (tx) => {
    // 登录成功删掉这个用户名的失败记录（规格 I-16）。
    await deps.repo.failures.delete(tx, lockoutKey(account.username));
    // 过了有效期的会话行在下次登录时删掉（规格 I-23）。不另起后台线程。
    await deps.repo.sessions.deleteExpired(tx, at);
    await deps.repo.sessions.insert(tx, {
      id: randomUUID(),
      userId: account.id,
      tokenHash: await hashToken(token),
      createdAt: at,
      lastSeenAt: at,
      expiresAt,
    });
    await ctx.emit(
      tx,
      LOGIN_SUCCEEDED,
      account.username,
      { userId: account.id, ip: input.ip },
      input.traceId,
    );
  });
  return { kind: "ok", user: toUser(account), token, expiresAt };
}

/** 访问闸用：令牌换成当前的人，顺带取他所属的组、判断要不要续期。 */
async function authenticate(
  ctx: IdentityContext,
  token: string,
): Promise<AuthenticatedSession | undefined> {
  const { deps } = ctx;
  const at = ctx.now();
  const live = await ctx.liveSession(token);
  if (!live) return undefined;
  if (live.account.disabledAt !== null) {
    // 兜底：停用的用例本来就在同一个事务里删光了它的会话，这里防的是两步之间漏网的。
    await deps.repo.sessions.delete(deps.db, live.session.id);
    return undefined;
  }
  // 组在认证这一个口子取一次（规格 G-34）：后面的路由、别的模块都从请求上下文拿，不再各问一遍。
  const groupIds = await deps.repo.groups.groupIdsForUser(deps.db, live.account.id);
  const remainingMs = live.session.expiresAt.getTime() - at.getTime();
  // 剩余还多的时候不动库、不重发：每个请求都续，等于给每个读请求加一次写（规格 I-22）。
  if (remainingMs >= SESSION_RENEW_AFTER_MS) {
    return { user: toUser(live.account), groupIds, renewed: false };
  }
  await deps.repo.sessions.renew(
    deps.db,
    live.session.id,
    new Date(at.getTime() + SESSION_TTL_MS),
    at,
  );
  return { user: toUser(live.account), groupIds, renewed: true };
}

/** 退出：删掉会话这一行。被复制走的旧 cookie 随即失效（规格 I-24）。 */
async function logout(
  ctx: IdentityContext,
  input: RequestTrace & { token: string },
): Promise<void> {
  const { deps } = ctx;
  const live = await ctx.liveSession(input.token);
  if (!live) return;
  await deps.db.transaction(async (tx) => {
    await deps.repo.sessions.delete(tx, live.session.id);
    await ctx.emit(
      tx,
      LOGOUT,
      live.account.username,
      { userId: live.account.id, ip: input.ip },
      input.traceId,
    );
  });
}
