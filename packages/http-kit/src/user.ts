import type { Context } from "hono";
import type { CurrentUser } from "@nexus/contracts";
import type { AppEnv } from "./env.ts";

/**
 * 取当前登录的人。只有声明成 user、admin 的路由上才有值：访问闸先验会话，再把它放进上下文。
 *
 * 没有值就直接抛，不回 401：一条要登录的路由走到了处理函数却没有当前用户，只能是接线出了错
 * （访问闸没挂上，或者访问级别写成了 public）。把它说成「没登录」会把接线错误藏起来（2026-11-27）。
 */
export function requireUser(c: Context<AppEnv>): CurrentUser {
  const user = c.get("user");
  if (!user) {
    throw new Error("上下文里没有当前用户：这条路由要登录，但访问闸没有先跑，或者访问级别写错了");
  }
  return user;
}
