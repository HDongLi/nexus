import { API_PREFIX, bind, type AnyRouteBinding, type AppEnv } from "@nexus/http-kit";
import { OpenAPIHono, type RouteConfig, type RouteHandler } from "@hono/zod-openapi";
import type { Logger } from "pino";
import { API_INFO, contractSources } from "./contract-sources.ts";
import { buildOpenApiDocument } from "./contract.ts";
import { accessGuard, type AccessVerifier } from "./http/access-guard.ts";
import { docRoute } from "./http/doc-route.ts";
import { errorHandler, notFound, validationHook } from "./http/errors.ts";
import { requestId, requestLogger } from "./http/observability.ts";

/** 一个模块交给应用挂载的东西。 */
export interface AppModule {
  name: string;
  bindings: readonly AnyRouteBinding[];
}

export interface AppDeps {
  log: Logger;
  modules: readonly AppModule[];
  verify: AccessVerifier;
}

/** 探活这类高频请求的日志降到 debug。 */
const QUIET_PATHS = [`${API_PREFIX}/system/health`];

/**
 * 组合根：把各模块的路由挂到唯一的 Hono 应用上。这里只有装配，没有业务（主张 P4）。
 * 返回的 app 不监听端口，所以测试可以直接用 app.request() 打它。
 */
export function createApp(deps: AppDeps) {
  const bindings: readonly AnyRouteBinding[] = [
    ...deps.modules.flatMap((module) => [...module.bindings]),
    // 契约文档自己也是一条路由，和别的路由走同一套声明与访问闸。
    bind(docRoute, async (c) =>
      c.json(
        buildOpenApiDocument(contractSources(), API_INFO) as unknown as Record<string, unknown>,
        200,
      ),
    ),
  ];

  const api = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // 中间件必须先于路由注册，否则轮不到它们。
  api.use(requestId);
  api.use(requestLogger(deps.log, QUIET_PATHS));
  api.use(`${API_PREFIX}/*`, accessGuard(bindings, deps.verify));
  for (const binding of bindings) {
    api.openapi(binding.route, binding.handler as RouteHandler<RouteConfig, AppEnv>);
  }
  api.onError(errorHandler(deps.log));
  api.notFound(notFound);

  return { app: api, bindings };
}
