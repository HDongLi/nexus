import type { Context, ErrorHandler, NotFoundHandler } from "hono";
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
    const error = err instanceof Error ? err : new Error(String(err));
    log.error(
      { requestId: c.get("requestId"), method: c.req.method, path: c.req.path, err: error },
      "请求处理失败",
    );
    return fail(c, 500, "internal_error", "服务器内部错误。带上请求号找管理员看日志");
  };
}

export const notFound: NotFoundHandler<AppEnv> = (c) => fail(c, 404, "not_found", "没有这个接口");
