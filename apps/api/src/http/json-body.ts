import type { MiddlewareHandler } from "hono";
import { fail, type AnyRouteBinding, type AppEnv } from "@nexus/http-kit";
import { findEntry, routeTable } from "./route-match.ts";

/** 请求的 Content-Type 是不是 JSON：application/json，或者带 +json 的子类型。 */
function isJsonContentType(value: string | undefined): boolean {
  const essence = value?.split(";")[0]?.trim() ?? "";
  return /^application\/([\w.-]+\+)?json$/i.test(essence);
}

function jsonBodyOf(binding: AnyRouteBinding): true | undefined {
  const body = binding.route.request?.body as { content?: Record<string, unknown> } | undefined;
  return Object.keys(body?.content ?? {}).some(isJsonContentType) ? true : undefined;
}

/**
 * 声明了 JSON 请求体的路由，在轮到框架校验之前先把正文看一眼：
 * - 没标成 JSON 的，回 400。框架自己会抛一个 415，而契约里这些路由只声明了 400。
 * - 不是合法 JSON 的，回 400。框架自己回的是一句纯文本，不是统一的失败形状（铁律 6）。
 * 两种都归到 invalid_request：「请求体和声明的不符」只有这一个码（规格 I-02）。2026-11-27 实测后加。
 *
 * 正文读出来之后框架会复用缓存，不会读第二次。
 */
export function jsonBodyGuard(bindings: readonly AnyRouteBinding[]): MiddlewareHandler<AppEnv> {
  const table = routeTable(bindings, jsonBodyOf);
  return async (c, next) => {
    if (findEntry(table, c.req.method, c.req.path) === undefined) return next();
    const type = c.req.header("content-type");
    if (type !== undefined && !isJsonContentType(type)) {
      return fail(
        c,
        400,
        "invalid_request",
        "请求体要标明是 JSON（Content-Type: application/json）",
      );
    }
    if (isJsonContentType(type)) {
      try {
        await c.req.json();
      } catch {
        return fail(c, 400, "invalid_request", "请求体不是合法的 JSON");
      }
    }
    return next();
  };
}
