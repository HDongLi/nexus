import { z } from "zod";

/**
 * 身份模块发出的五个事件（规格 I-39）。名字带三层：模块.对象.动作。
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
/** 命令行建号成功。 */
export const USER_CREATED = "identity.user.created" as const;

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

export const loginSucceededPayload = z.strictObject({ userId, ip });
export const loginFailedPayload = z.strictObject({ ip, reason: z.enum(loginFailedReasons) });
export const logoutPayload = z.strictObject({ userId, ip });
/** revokedSessions：改密时被吊销的其它会话数。 */
export const passwordChangedPayload = z.strictObject({
  userId,
  ip,
  revokedSessions: z.number().int().min(0),
});
/** via：账号是怎么建出来的。这一片只有命令行一种。 */
export const userCreatedPayload = z.strictObject({
  userId: z.string().uuid(),
  isAdmin: z.boolean(),
  via: z.literal("cli"),
});

export type LoginSucceededPayload = z.output<typeof loginSucceededPayload>;
export type LoginFailedPayload = z.output<typeof loginFailedPayload>;
export type LogoutPayload = z.output<typeof logoutPayload>;
export type PasswordChangedPayload = z.output<typeof passwordChangedPayload>;
export type UserCreatedPayload = z.output<typeof userCreatedPayload>;
