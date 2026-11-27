import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { fail, type AppEnv } from "@nexus/http-kit";
import type { Logger } from "pino";
import type { ZodError } from "zod";

type ValidationResult = { success: true } | { success: false; error: ZodError };

/** 参数校验不过时回 400，并说清是哪一项不对（实弹条款 2：失败要说清楚为什么）。 */
export function validationHook(result: ValidationResult, c: Context<AppEnv>) {
  if (result.success) return;
  return fail(c, 400, "invalid_request", "请求参数不合法", {
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  });
}

/** 没接住的处理函数抛出的异常：记日志（带堆栈和请求号），回一个不漏内部细节的 500。 */
export function errorHandler(log: Logger): ErrorHandler<AppEnv> {
  return (err, c) => {
    // 只认 4xx：5xx 的 HTTPException 是处理函数自己报的故障，照下面的路走——回 500 internal_error，别把它说成「请求不合法」。
    if (err instanceof HTTPException && err.status >= 400 && err.status < 500) {
      // 校验器和框架用 HTTPException 说「这个请求本身不对」（比如媒体类型不对）。它不是服务器的错：
      // 照它给的状态码回统一的形状，记一条警告，不当成故障去记堆栈。
      // 2026-11-27 加：骨架期的处理函数不收请求体，这条路一次都没走过；第一条带请求体的路由一接上，
      // 发错媒体类型的请求就被它回成了 500。
      const status = err.status;
      const notFound = status === 404;
      log.warn(
        {
          requestId: c.get("requestId"),
          method: c.req.method,
          path: c.req.path,
          status,
          reason: err.message,
        },
        "请求被拒绝",
      );
      return fail(
        c,
        status,
        notFound ? "not_found" : "invalid_request",
        notFound ? "没有这个接口" : "请求不合法",
        {
          reason: err.message,
        },
      );
    }
    const error = err instanceof Error ? err : new Error(String(err));
    log.error(
      { requestId: c.get("requestId"), method: c.req.method, path: c.req.path, err: error },
      "请求处理失败",
    );
    return fail(c, 500, "internal_error", "服务器内部错误。带上请求号找管理员看日志");
  };
}

export const notFound: NotFoundHandler<AppEnv> = (c) => fail(c, 404, "not_found", "没有这个接口");
