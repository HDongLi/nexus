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

/** 把一条声明好的路由接到处理函数上。 */
export function bind<R extends RouteConfig>(
  declared: DeclaredRoute<R>,
  handler: RouteHandler<R, AppEnv>,
): RouteBinding<R> {
  return { access: declared.access, route: declared.route, handler };
}
