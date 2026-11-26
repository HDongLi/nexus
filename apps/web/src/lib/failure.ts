import type { ApiFailure } from "@nexus/api-client";

/** 把一次失败翻成给人看的一句话，必要时带上「现在能怎么办」。 */
export function explainFailure(failure: ApiFailure): { title: string; detail: string } {
  const KNOWN: Record<string, { title: string; detail: string }> = {
    auth_not_wired: { title: "需要登录", detail: "身份模块还没有接入，这个接口暂时用不了。" },
    unauthenticated: { title: "登录已过期", detail: "刷新页面重新登录。" },
    forbidden: { title: "没有权限", detail: "找管理员给你开这个权限。" },
    not_found: { title: "找不到", detail: "这条内容可能已经被删掉了。" },
    invalid_request: { title: "提交的内容不合法", detail: failure.message },
  };
  const known = KNOWN[failure.code];
  if (known) return known;
  if (failure.status >= 500)
    return { title: "服务器出了问题", detail: "带上下面的请求号找管理员。" };
  return { title: "没有成功", detail: failure.message };
}
