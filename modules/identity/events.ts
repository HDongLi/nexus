import { z } from "zod";

/**
 * 身份模块发出的账号类事件（规格 I-39 加人员规格的事件表）。名字带三层：模块.对象.动作。
 * 会话与登录的五个在上面，账号管理的五个在这里；用户组的四个在 group-events.ts。
 * subject 一律是用户名；payload 的键只有下面列的这些，不许出现口令、散列、盐、令牌（规格 I-40）。
 */

/** 登录成功。 */
export const LOGIN_SUCCEEDED = "identity.login.succeeded" as const;
/** 用户名或口令不对；锁定中被拒；停用账号口令正确。 */
export const LOGIN_FAILED = "identity.login.failed" as const;
/** 退出成功。 */
export const LOGOUT = "identity.logout" as const;
/** 改密成功。 */
export const PASSWORD_CHANGED = "identity.password.changed" as const;
/** 建号成功：命令行，或管理员（规格事件表，via 放宽成两个值）。 */
export const USER_CREATED = "identity.user.created" as const;
/** 显示名或管理员位真的变了（规格 G-13）。 */
export const USER_UPDATED = "identity.user.updated" as const;
/** 管理员重置口令（规格 G-14）。 */
export const USER_PASSWORD_RESET = "identity.user.password.reset" as const;
/** 停用（规格 G-15）。 */
export const USER_DISABLED = "identity.user.disabled" as const;
/** 启用（规格 G-16）。 */
export const USER_ENABLED = "identity.user.enabled" as const;
/** 删号（规格 G-22）。 */
export const USER_DELETED = "identity.user.deleted" as const;

export const loginFailedReasons = [
  "invalid_credentials",
  "locked_out",
  "account_disabled",
] as const;
export type LoginFailedReason = (typeof loginFailedReasons)[number];

/** 来源地址。它靠代理头带进来，可以伪造，所以只写进事件留痕，不参与锁定（规格 I-12）。 */
const ip = z.string().min(1);
/**
 * 当事人的账号编号（就是账号行上的 id）。登录成功、退出、改密成功都带它：
 * subject 里的用户名是给人看的，以后可能允许改，编号才是不变的，别的模块对账、审计查询都用它
 * （规格事件表，2026-11-27 编排者补）。登录失败不带：失败时未必有这个人。
 */
const userId = z.string().uuid();
/** 操作者的账号编号。管理员触发的写事件都带（人员规格「事件」一节）。 */
const actorId = z.string().uuid();

export const loginSucceededPayload = z.strictObject({ userId, ip });
export const loginFailedPayload = z.strictObject({ ip, reason: z.enum(loginFailedReasons) });
export const logoutPayload = z.strictObject({ userId, ip });
/** revokedSessions：改密时被吊销的其它会话数。 */
export const passwordChangedPayload = z.strictObject({
  userId,
  ip,
  revokedSessions: z.number().int().min(0),
});

/**
 * via：账号是怎么建出来的。命令行（cli）没有操作者；管理员建的必须带 actorId（规格事件表）。
 * 2026-11-28 起放宽成两个值：人员规格把管理员建号接了进来。
 */
export const userCreatedPayload = z
  .strictObject({
    userId: z.string().uuid(),
    isAdmin: z.boolean(),
    via: z.enum(["cli", "admin"]),
    actorId: actorId.optional(),
  })
  .refine(
    (payload) =>
      payload.via === "admin" ? payload.actorId !== undefined : payload.actorId === undefined,
    "via 是 admin 时必须带 actorId，是 cli 时不能带",
  );

/** 一处改动的前后两个值。 */
const change = z.strictObject({ from: z.string(), to: z.string() });
/** 管理员位是布尔：前后两个值也是布尔（规格事件表的 changes，同工程规格「只列真变了的键」）。 */
const booleanChange = z.strictObject({ from: z.boolean(), to: z.boolean() });

/** changes 只列真变了的键（规格事件表）；一个都没有的事件是写错了，形状上就过不去。 */
export const userUpdatedPayload = z.strictObject({
  userId,
  actorId,
  changes: z
    .strictObject({ displayName: change.optional(), isAdmin: booleanChange.optional() })
    .refine(
      (changes) => changes.displayName !== undefined || changes.isAdmin !== undefined,
      "changes 里至少要有一处改动",
    ),
});

export type UserUpdatedChanges = {
  displayName?: { from: string; to: string };
  isAdmin?: { from: boolean; to: boolean };
};

/** revokedSessions：重置口令吊销了这个人自己的全部会话（规格 G-14）。 */
export const userPasswordResetPayload = z.strictObject({
  userId,
  actorId,
  revokedSessions: z.number().int().min(0),
});

export const userDisabledPayload = z.strictObject({ userId, actorId });
export const userEnabledPayload = z.strictObject({ userId, actorId });
/** groupIds：删之前他在哪些组里（规格事件表）。 */
export const userDeletedPayload = z.strictObject({
  userId,
  actorId,
  groupIds: z.array(z.string().uuid()),
});

export type LoginSucceededPayload = z.output<typeof loginSucceededPayload>;
export type LoginFailedPayload = z.output<typeof loginFailedPayload>;
export type LogoutPayload = z.output<typeof logoutPayload>;
export type PasswordChangedPayload = z.output<typeof passwordChangedPayload>;
export type UserCreatedPayload = z.output<typeof userCreatedPayload>;
export type UserUpdatedPayload = z.output<typeof userUpdatedPayload>;
export type UserPasswordResetPayload = z.output<typeof userPasswordResetPayload>;
export type UserDisabledPayload = z.output<typeof userDisabledPayload>;
export type UserEnabledPayload = z.output<typeof userEnabledPayload>;
export type UserDeletedPayload = z.output<typeof userDeletedPayload>;
