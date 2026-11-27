import type { AuthLevel } from "@nexus/contracts";
import { SESSION_COOKIE, type DeclaredRoute } from "@nexus/http-kit";
import { OpenAPIHono, type RouteConfig, type RouteHandler } from "@hono/zod-openapi";
import type { AppEnv } from "@nexus/http-kit";

/** 一个模块交出来给契约文档的东西：名字（当标签用）和路由声明。 */
export interface ContractSource {
  name: string;
  routes: readonly DeclaredRoute[];
}

export interface ApiInfo {
  title: string;
  version: string;
  [key: `x-${string}`]: unknown;
}

export type OpenApiDocument = ReturnType<OpenAPIHono<AppEnv>["getOpenAPI31Document"]>;

function contractOnly(): never {
  throw new Error("这条路由只为生成契约文档而注册，不该被调用");
}

/**
 * 把各模块的路由声明合成一份 OpenAPI 3.1 文档。只依赖声明，不碰数据库，不启动进程。
 * 每个操作都标上访问级别（x-auth），需要登录的再标上鉴权方式。
 */
export function buildOpenApiDocument(
  sources: readonly ContractSource[],
  info: ApiInfo,
): OpenApiDocument {
  const app = new OpenAPIHono<AppEnv>();
  for (const source of sources) {
    for (const declared of source.routes) {
      app.openapi(declared.route, contractOnly as unknown as RouteHandler<RouteConfig, AppEnv>);
    }
  }
  const doc = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info,
    // 同名只列一次：契约文档那条路由归在 system 名下，和系统模块同名，逐个照搬会把 system 列两遍（2026-11-27 修）。
    tags: [...new Map(sources.map((source) => [source.name, { name: source.name }])).values()],
  });
  // 这个版本的 @hono/zod-openapi 不在文档配置里收 components，所以直接并到生成的文档上。
  doc.components = {
    ...doc.components,
    securitySchemes: {
      ...doc.components?.securitySchemes,
      cookieSession: { type: "apiKey", in: "cookie", name: SESSION_COOKIE },
    },
  };

  const levels = new Map<string, AuthLevel>();
  for (const source of sources) {
    for (const declared of source.routes)
      levels.set(`${declared.route.method} ${declared.route.path}`, declared.access);
  }
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, raw] of Object.entries(item)) {
      const level = levels.get(`${method} ${path}`);
      if (level === undefined || typeof raw !== "object" || raw === null) continue;
      const operation: Record<string, unknown> = { ...raw, "x-auth": level };
      if (level !== "public") operation.security = [{ cookieSession: [] }];
      (item as Record<string, unknown>)[method] = operation;
    }
  }
  return doc;
}
