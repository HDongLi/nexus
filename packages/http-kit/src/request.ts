import type { Context } from "hono";
import type { AppEnv } from "./env.ts";

/**
 * 请求的协议。进程自己不终结 TLS，协议只认反向代理写进 X-Forwarded-Proto 的值，
 * 取最后一跳（离本进程最近的那台代理写的）；没有这个头就是 http。
 * 两处用它：会话 cookie 在 https 来路上加 Secure（规格 I-20），没配对外地址时拿它拼出请求自己的地址（规格 I-37）。
 */
export function requestProtocol(c: Context<AppEnv>): "http" | "https" {
  const forwarded = c.req.header("x-forwarded-proto");
  const lastHop = forwarded?.split(",").pop()?.trim().toLowerCase();
  return lastHop === "https" ? "https" : "http";
}
