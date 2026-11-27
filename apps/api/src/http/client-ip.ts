import type { Context } from "hono";
import type { AppEnv } from "@nexus/http-kit";

/**
 * 来源地址：有 X-Real-IP 头就是它（反向代理改写后转进来的），没有就是连接的对端地址；都没有记 unknown。
 * 它只写进事件留痕，不参与任何判断：来源地址靠代理头带进来，可以伪造，拿它计数挡不住分散的尝试（规格 I-12）。
 * 这个头假定是代理写的；新仓还没有部署配置，部署配置落下来时要对一遍（规格「未确定」）。
 */
export function clientIp(c: Context<AppEnv>): string {
  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;
  // 连接的对端地址只有 Node 的监听器会放进 c.env；app.request() 这种不起进程的调用里它是空的。
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}
