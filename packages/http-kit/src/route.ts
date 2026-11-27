import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { createRoute } from "@hono/zod-openapi";
import type { AuthLevel } from "@nexus/contracts";
import type { AppEnv } from "./env.ts";

/** 一条路由的声明：谁能访问，长什么样。生成契约文档只用到这一半，不需要数据库。 */
export interface DeclaredRoute<R extends RouteConfig = RouteConfig> {
  access: AuthLevel;
  route: R;
}

/** 一条声明好的路由接上了处理函数。 */
export interface RouteBinding<R extends RouteConfig = RouteConfig> extends DeclaredRoute<R> {
  handler: RouteHandler<R, AppEnv>;
}

/**
 * 任意一条绑好的路由。交给应用去挂载的清单用这个类型。
 * 处理函数的类型和它那条路由的形状绑在一起，没法既泛化又不丢类型，
 * 所以这里的签名故意写得最宽（任何具体的处理函数都能赋给它）。
 */
export interface AnyRouteBinding {
  access: AuthLevel;
  route: RouteConfig;
  handler: (c: never, next: never) => unknown;
}

/** 声明一条路由。访问级别没有默认值：每条路由都必须自己说清楚。 */
export function route<P extends string, R extends Omit<RouteConfig, "path"> & { path: P }>(
  access: AuthLevel,
  config: R,
): DeclaredRoute<R> {
  return { access, route: createRoute(config) };
}

/** 处理函数可以交回的东西：这条路由声明过的那几种回应，或者任何一个 Response（失败回应就是后者）。 */
export type HandlerReturn<R extends RouteConfig> =
  | ReturnType<RouteHandler<R, AppEnv>>
  | Response
  | Promise<Response>;

/**
 * 把一条声明好的路由接到处理函数上。
 *
 * 成功的回应仍然按路由声明查类型：c.json 回的正文和状态码对不上声明，这里就编译不过。
 * 失败的回应（fail() 回的）在类型上放宽成 Response。生成器给每条路由算出来的回应类型，是它把
 * 契约的正文再转成一遍 JSON 安全形状的结果，和统一失败形状的原始类型互相赋不上；而 errors() 声明的
 * 那些状态码本来也不在这份类型里，所以收紧它换不来任何检查（2026-11-27，身份模块第一次让处理函数回失败时实测）。
 */
export function bind<R extends RouteConfig>(
  declared: DeclaredRoute<R>,
  handler: (c: Parameters<RouteHandler<R, AppEnv>>[0]) => HandlerReturn<R>,
): RouteBinding<R> {
  return {
    access: declared.access,
    route: declared.route,
    handler: handler as RouteHandler<R, AppEnv>,
  };
}
