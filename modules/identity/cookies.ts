import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { requestProtocol, SESSION_COOKIE, type AppEnv } from "@nexus/http-kit";

/** cookie 的有效期，秒。30 天，和会话的有效期一致；续期时重发同一个值。 */
export const SESSION_MAX_AGE_SECONDS = 2_592_000;

/**
 * 会话 cookie 的属性（规格 I-19、I-20）。每一项都有来由：
 * - `Path=/` 不能省。省了，浏览器会把 cookie 的作用范围缩到下发它的那个目录，别的接口永远拿不到
 *   （旧系统 0.53.1 的事故）。
 * - `HttpOnly`：页面上的脚本读不到令牌，页面被注入也偷不走会话。
 * - `SameSite=Lax`：别的站点发起的跨站写请求不会带上它，是跨站请求伪造的第一道防线。
 * - 不写 `Domain`：只属于当前这台主机，子域名拿不到。
 * - `Max-Age`：到期由浏览器自己丢；服务端另有过期时间，两边都以续期后的值为准。
 * - `Secure` 只在请求的协议是 https 时加（台账 BUG-2026-10-29-62）。进程自己不终结 TLS，协议看请求头。
 */
function attributes(c: Context<AppEnv>): CookieOptions {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: requestProtocol(c) === "https",
  };
}

export interface SessionCookie {
  /** 把令牌放进响应头。 */
  set(c: Context<AppEnv>, token: string): void;
  /** 让浏览器把 cookie 丢掉：同名、同一个 Path、Max-Age=0、过去的 Expires。属性照下发时的样子，浏览器才认得出是同一枚。 */
  clear(c: Context<AppEnv>): void;
}

export const sessionCookie: SessionCookie = {
  set(c, token) {
    setCookie(c, SESSION_COOKIE, token, attributes(c));
  },
  clear(c) {
    // hono 的 deleteCookie 只写 Max-Age=0，不带 Expires；这里自己补上过去的时间（规格 I-24）。
    deleteCookie(c, SESSION_COOKIE, { ...attributes(c), expires: new Date(0) });
  },
};
