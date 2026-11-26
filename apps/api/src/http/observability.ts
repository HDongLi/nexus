import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { AppEnv } from "@nexus/http-kit";
import { randomUUID } from "node:crypto";

/** 每个请求一个请求号：优先沿用调用方带来的，没有或长得离谱就新造。写进上下文和响应头。 */
export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header("x-request-id")?.trim();
  c.set("requestId", incoming && incoming.length <= 128 ? incoming : randomUUID());
  await next();
  c.header("x-request-id", c.get("requestId"));
};

/** 一行结构化日志记一次请求。排障先读它（实弹条款 3：证据先行）。 */
export function requestLogger(
  log: Logger,
  quietPaths: readonly string[] = [],
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const record = {
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    };
    // 探活这类高频请求降到 debug，免得把日志淹了。
    if (quietPaths.includes(c.req.path)) log.debug(record, "request");
    else log.info(record, "request");
  };
}
