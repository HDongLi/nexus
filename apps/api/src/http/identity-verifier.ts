import { getCookie } from "hono/cookie";
import { fail, SESSION_COOKIE } from "@nexus/http-kit";
import { authErrorCodes, type IdentityModule } from "@nexus/identity";
import type { AccessVerifier } from "./access-guard.ts";

/** 「现在没有登录」时回的话。没带 cookie 和会话失效用同一句，不告诉人手里的令牌曾经有效过。 */
export const LOGIN_REQUIRED_MESSAGE = "请先登录";

/**
 * 真正的验证器：把会话 cookie 交给身份模块，换出当前的人（设计 01「访问闸」）。
 * 骨架期那个一律回 501 的占位验证器已经删掉，这里不再说「身份模块还没有接入」（规格 I-05）。
 */
export function createIdentityVerifier(identity: IdentityModule): AccessVerifier {
  return async (c, level) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return fail(c, 401, authErrorCodes.required, LOGIN_REQUIRED_MESSAGE);
    const session = await identity.service.authenticate(token);
    if (!session) return fail(c, 401, authErrorCodes.required, LOGIN_REQUIRED_MESSAGE);
    c.set("user", session.user);
    // 会话续期了就把同一枚 cookie 重发一遍，浏览器里的有效期跟着往后挪（规格 I-22）。
    if (session.renewed) identity.sessionCookie.set(c, token);
    // 判 admin 级用的就是 isAdmin 这一个字段，和「我是谁」回的是同一个（规格 I-27）。
    if (level === "admin" && !session.user.isAdmin) {
      return fail(c, 403, authErrorCodes.forbidden, "这件事只有管理员能做");
    }
    return undefined;
  };
}
