export { API_PREFIX, SESSION_COOKIE } from "./constants.ts";
export type { AppEnv } from "./env.ts";
export { fail } from "./fail.ts";
export { requestProtocol } from "./request.ts";
export { bind, route } from "./route.ts";
export type { AnyRouteBinding, DeclaredRoute, HandlerReturn, RouteBinding } from "./route.ts";
export { errors, json } from "./responses.ts";
export { requireUser } from "./user.ts";
// 路由声明只依赖这个包和 zod（铁律 5）。「现在是谁」的形状住在契约包里，从这里转一手给路由声明用。
export { currentUser } from "@nexus/contracts";
export type { CurrentUser } from "@nexus/contracts";
