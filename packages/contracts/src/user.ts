import { z } from "zod";

/**
 * 「现在是谁」。登录和我是谁都回这一个形状，访问闸也把它放进请求上下文（2026-11-27，规格 I-26）。
 * 恰好四个键，多一个都是往外多漏一样东西：旧系统的我是谁另回开发者旗、超管旗、可见工程，
 * 那是这家单位的权限模型，不进内核。
 */
export const currentUser = z.strictObject({
  /** 账号编号。别的模块记「这件事是谁做的」用它：用户名是给人看的，编号才不变。 */
  id: z.string().uuid(),
  username: z.string().min(1),
  displayName: z.string(),
  /** 只读账号上的一个布尔位，不从任何用户组推导（规格 I-27）。 */
  isAdmin: z.boolean(),
});

export type CurrentUser = z.output<typeof currentUser>;
