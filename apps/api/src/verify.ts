import { fail } from "@nexus/http-kit";
import type { AccessVerifier } from "./http/access-guard.ts";

/**
 * 骨架期的鉴权：身份模块还没有接入，需要登录的接口一律回 501，并把原因说清楚。
 * 这是「没有声明就不放行」的另一半：不是忘了鉴权，是明知道还没做，也不假装做了。
 * 身份模块接入后，由组合根换成真正的验证器，这个文件删掉。
 */
export const notWiredYet: AccessVerifier = async (c, level) =>
  fail(
    c,
    501,
    "auth_not_wired",
    `这个接口需要${level === "admin" ? "管理员" : "登录"}，身份模块还没有接入`,
  );
