import type { ApiFailure, CallResult } from "@nexus/api-client";

/** 失败响应里 `error.details` 带的东西。现在只有一种：锁定还要等多少秒。 */
export interface FailureDetails {
  retryAfterSeconds?: number;
}

/** 从客户端返回的整个结果里取 details。响应不是约定的形状时给空的，不崩。 */
export function detailsOf(result: CallResult): FailureDetails {
  const details = (result.error as { error?: { details?: { retryAfterSeconds?: unknown } } } | null)
    ?.error?.details?.retryAfterSeconds;
  return typeof details === "number" && Number.isFinite(details)
    ? { retryAfterSeconds: details }
    : {};
}

/** 还要等多久，给人看的写法：不满一分钟说秒，满了说分钟（向上取整，别说早了）。 */
export function waitingTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 1) return "稍后";
  if (seconds < 60) return `${Math.ceil(seconds)} 秒后`;
  return `${Math.ceil(seconds / 60)} 分钟后`;
}

/** 锁定的那句话。「稍后」是词，前面不空格；数字前面空一格。 */
function lockoutDetail(seconds: number | undefined): string {
  const wait = waitingTime(seconds);
  return `请${wait === "稍后" ? "" : " "}${wait}再试。`;
}

/** 一句标题、一句现在能怎么办；要找管理员的失败再带一个请求号。 */
export interface Explanation {
  title: string;
  detail: string;
  /** 只有服务器出了问题、或者不认识的失败才带：找管理员时对得上日志。口令不对这类预期的失败不带，带了只是噪音。 */
  requestId?: string;
}

/**
 * 把一次失败翻成给人看的一句话，必要时带上「现在能怎么办」。
 * 认识的码照规格的错误码表来说（docs/spec/identity.md）；不认识的，5xx 说成服务器的问题，
 * 其余原样转述服务器的话。
 */
export function explainFailure(failure: ApiFailure, details: FailureDetails = {}): Explanation {
  switch (failure.code) {
    case "auth_invalid_credentials":
      return { title: "用户名或口令不对", detail: "检查一下再试。" };
    case "auth_locked_out":
      return { title: "试错次数太多", detail: lockoutDetail(details.retryAfterSeconds) };
    case "auth_account_disabled":
      return { title: "账号已停用", detail: "找管理员重新启用。" };
    case "auth_required":
      return { title: "需要登录", detail: "登录已失效，请重新登录。" };
    case "auth_forbidden":
      return { title: "权限不够", detail: "这个账号做不了这件事，找管理员。" };
    case "csrf_origin_mismatch":
      return { title: "页面地址对不上", detail: "用管理员给的地址重新打开，再试一次。" };
    case "auth_current_password_wrong":
      return { title: "旧口令不对", detail: "重新输入现在的口令。" };
    case "auth_password_too_weak":
      // 最短长度是服务器的配置，页面不知道，照服务器说的转述。
      return { title: failure.message, detail: "换一个更长的。" };
    case "auth_password_reused":
      return { title: "新口令和旧口令一样", detail: "换一个没用过的口令。" };
    case "invalid_request":
      return { title: "提交的内容不合法", detail: failure.message };
    case "projects_slug_taken":
      return { title: "短名已被占用", detail: "换一个短名再试。" };
    case "projects_forbidden":
      return { title: "权限不够", detail: "只有创建者和管理员能改这个工程。" };
    case "projects_creation_failed":
      return {
        title: "工程没有建成",
        detail: "仓库没有建起来，什么都没有留下。稍后再试；还不行带请求号找管理员。",
        requestId: failure.requestId,
      };
    case "not_found":
      return { title: "找不到", detail: "这条内容可能已经被删掉了。" };
    case "identity_username_taken":
      // 规格 G-41：护栏的几种 409 要让人看得懂是哪一种。用户名撞了是字段的事，
      // 对话框会把它挪到用户名那一栏挨着说；这里的标题就是那一栏的话。
      return { title: "用户名已被占用", detail: "换一个用户名再试。" };
    case "identity_group_name_taken":
      return { title: "组名已被占用", detail: "换一个组名再试。组名不分大小写。" };
    case "identity_last_admin":
      return {
        title: "这是最后一个管理员",
        detail: "系统至少要留一个启用的管理员。先建一个或启用另一个管理员，再来改这一个。",
      };
    case "identity_self_change":
      return {
        title: "不能对自己做这个",
        detail:
          "停用、删除、降级和重置口令都不能落在自己头上。要改自己的口令，用账号菜单里的「修改口令」。",
      };
    case "identity_user_has_projects":
      return {
        title: "建过工程的账号只能停用",
        detail: "这个账号创建过工程，删掉会让这些工程没有创建者。要收走权限就停用它。",
      };
    case "network_error":
      return { title: "连不上服务器", detail: "检查网络，稍后重试。" };
  }
  if (failure.status >= 500)
    return {
      title: "服务器出了问题",
      detail: "带上下面的请求号找管理员。",
      requestId: failure.requestId,
    };
  return { title: "没有成功", detail: failure.message, requestId: failure.requestId };
}

/** 浏览器根本没连上（后端没起、断网）：fetch 直接抛，没有状态码也没有响应体。 */
export const NETWORK_FAILURE: ApiFailure = {
  status: 0,
  code: "network_error",
  message: "连不上服务器",
  requestId: "unknown",
};
