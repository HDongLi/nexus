import type { MiddlewareHandler } from "hono";
import { fail, requestProtocol, type AppEnv } from "@nexus/http-kit";
import { authErrorCodes } from "@nexus/identity";
import type { Logger } from "pino";

/** 读方法。它们不改状态，所以不查来源（规格 I-35）。改状态的接口不得用读方法。 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface OriginCheck {
  method: string;
  origin: string | undefined;
  /** 配置项 PUBLIC_ORIGIN，启动时校验过。没配就按请求自己的地址比。 */
  publicOrigin: string | undefined;
  /** 请求的协议，取自 X-Forwarded-Proto 的最后一跳。 */
  protocol: string;
  host: string | undefined;
}

/** 拆开一个地址，只留协议、主机、端口三项。解析不了，或者不是 http、https，就回 undefined。 */
function parseOrigin(
  value: string,
): { protocol: string; hostname: string; port: string } | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    // URL 解析已经把协议和主机转成小写，也把默认端口折算掉了（https://a.com:443 和 https://a.com 是同一个）。
    return { protocol: url.protocol, hostname: url.hostname, port: url.port };
  } catch {
    return undefined;
  }
}

/**
 * 判定一个写请求的来源放不放行（规格 I-36、I-37）。纯函数，不碰请求：
 * - 读方法不查。
 * - 不带 Origin：放行。命令行、代理、测试不是浏览器，它们的 cookie 不会被别的页面自动带上。
 * - `Origin: null`：拒绝。它解析不成地址，自然落在下面的拒绝里。
 * - 其余：Origin 和对外地址解析之后，协议、主机、端口三项都一样才放行。
 */
export function originAllowed(check: OriginCheck): boolean {
  if (READ_METHODS.has(check.method.toUpperCase())) return true;
  if (check.origin === undefined) return true;
  const expected =
    check.publicOrigin ??
    (check.host === undefined ? undefined : `${check.protocol}://${check.host}`);
  if (expected === undefined) return false;
  const a = parseOrigin(check.origin);
  const b = parseOrigin(expected);
  return (
    a !== undefined &&
    b !== undefined &&
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    a.port === b.port
  );
}

/**
 * 来源校验：跨站请求伪造靠两样东西挡，SameSite=Lax 的 cookie，加上这一条（设计 01「来源校验」）。
 * 挂在 /api/v1/* 上、访问闸之前，只管写方法，不分访问级别：登录是公开路由，照样要挡。
 */
export function originGuard(deps: {
  publicOrigin: string | undefined;
  log: Logger;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = c.req.header("origin");
    const protocol = requestProtocol(c);
    const host = c.req.header("host");
    if (
      !originAllowed({
        method: c.req.method,
        origin,
        publicOrigin: deps.publicOrigin,
        protocol,
        host,
      })
    ) {
      // 记下两边的值：部署配错了（比如反向代理改写了 Host、又没配 PUBLIC_ORIGIN）时，靠这一行对出来。
      deps.log.warn(
        {
          requestId: c.get("requestId"),
          method: c.req.method,
          path: c.req.path,
          origin,
          expected: deps.publicOrigin ?? (host === undefined ? undefined : `${protocol}://${host}`),
        },
        "来源校验拒绝",
      );
      return fail(
        c,
        403,
        authErrorCodes.originMismatch,
        "请求不是从这个系统自己的页面发出来的，已拒绝",
      );
    }
    return next();
  };
}
