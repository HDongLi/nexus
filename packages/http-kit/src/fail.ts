import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorBody } from "@nexus/contracts";
import type { AppEnv } from "./env.ts";

/**
 * 处理函数统一用它回失败：形状固定，带请求号，页面据此把原因显示出来（实弹条款 2）。
 * 请求号还没生成就出了错时记作 unknown，不影响把失败说清楚。
 */
export function fail<S extends ContentfulStatusCode>(
  c: Context<AppEnv>,
  status: S,
  code: string,
  message: string,
  details?: ErrorBody["error"]["details"],
) {
  const error: ErrorBody["error"] = { code, message, requestId: c.get("requestId") || "unknown" };
  if (details !== undefined) error.details = details;
  return c.json({ error } satisfies ErrorBody, status);
}
