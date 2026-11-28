import type { ApiFailure } from "@nexus/api-client";
import { describe, expect, it } from "vitest";
import { detailsOf, explainFailure, waitingTime } from "./failure.ts";

const failure = (patch: Partial<ApiFailure>): ApiFailure => ({
  status: 500,
  code: "internal_error",
  message: "服务器内部错误",
  requestId: "r-1",
  ...patch,
});

/** 身份规格的错误码表里的九个码（docs/spec/identity.md），每个都要有自己的说法。 */
const CODES = [
  ["auth_invalid_credentials", 401, "用户名或口令不对"],
  ["auth_account_disabled", 403, "账号已停用"],
  ["auth_required", 401, "需要登录"],
  ["auth_forbidden", 403, "权限不够"],
  ["csrf_origin_mismatch", 403, "页面地址对不上"],
  ["auth_current_password_wrong", 400, "旧口令不对"],
  ["auth_password_reused", 400, "新口令和旧口令一样"],
] as const;

/** 人员与用户组这一片新加的五个码（docs/spec/people.md 错误码表），都是 409。 */
const PEOPLE_CODES = [
  ["identity_username_taken", "用户名已被占用"],
  ["identity_group_name_taken", "组名已被占用"],
  ["identity_last_admin", "这是最后一个管理员"],
  ["identity_self_change", "不能对自己做这个"],
  ["identity_user_has_projects", "建过工程的账号只能停用"],
] as const;

describe("把失败翻成给人看的话", () => {
  it.each(CODES)("认识的错误码 %s 给出专门的标题和下一步", (code, status, title) => {
    const text = explainFailure(failure({ code, status }));
    expect(text.title).toBe(title);
    expect(text.detail.length).toBeGreaterThan(4);
    // 自己的话，不是服务器那句原样搬过来的。
    expect(text.detail).not.toBe("服务器内部错误");
    // 预期的失败不带请求号：对口令不对这种事，请求号帮不上什么忙，只会占地方。
    expect(text.requestId).toBeUndefined();
  });

  it("锁定：说出还要等多久，秒数取自 details.retryAfterSeconds", () => {
    const locked = failure({ status: 429, code: "auth_locked_out" });
    expect(explainFailure(locked, { retryAfterSeconds: 900 })).toEqual({
      title: "试错次数太多",
      detail: "请 15 分钟后再试。",
    });
    expect(explainFailure(locked, { retryAfterSeconds: 45 }).detail).toBe("请 45 秒后再试。");
    // 899 秒说成 15 分钟：向上取整，宁可让人多等，别让人白跑。
    expect(explainFailure(locked, { retryAfterSeconds: 899 }).detail).toBe("请 15 分钟后再试。");
    expect(explainFailure(locked, { retryAfterSeconds: 1 }).detail).toBe("请 1 秒后再试。");
    expect(explainFailure(locked, { retryAfterSeconds: 1 }).requestId).toBeUndefined();
  });

  it("锁定但服务器没给秒数：不下结论，只说稍后", () => {
    expect(explainFailure(failure({ status: 429, code: "auth_locked_out" }))).toEqual({
      title: "试错次数太多",
      detail: "请稍后再试。",
    });
  });

  it("新口令太短：最短长度是服务器的配置，照服务器的话转述", () => {
    expect(
      explainFailure(
        failure({
          status: 400,
          code: "auth_password_too_weak",
          message: "新口令太短，至少 12 个字符",
        }),
      ),
    ).toEqual({ title: "新口令太短，至少 12 个字符", detail: "换一个更长的。" });
  });

  it("已经不存在的码没有专门的说法：auth_not_wired 落到兜底", () => {
    const text = explainFailure(failure({ status: 501, code: "auth_not_wired" }));
    expect(text.title).toBe("服务器出了问题");
    expect(text.detail).toMatch(/请求号/);
  });

  it("不认识的 5xx 说清楚是服务器的问题，并指向请求号", () => {
    const text = explainFailure(failure({ code: "something_new" }));
    expect(text.title).toBe("服务器出了问题");
    expect(text.detail).toMatch(/请求号/);
    // 要找管理员的失败才带请求号。
    expect(text.requestId).toBe("r-1");
  });

  it("连不上服务器", () => {
    expect(explainFailure(failure({ status: 0, code: "network_error" }))).toEqual({
      title: "连不上服务器",
      detail: "检查网络，稍后重试。",
    });
    // 连都没连上，没有请求号可给（failureOf 填的 unknown 不给人看）。
    expect(explainFailure(failure({ status: 0, code: "network_error" })).requestId).toBeUndefined();
  });

  it("参数不合法时原样转述服务器的说明", () => {
    expect(
      explainFailure(failure({ status: 400, code: "invalid_request", message: "名字太长" })).detail,
    ).toBe("名字太长");
  });

  it.each(PEOPLE_CODES)("人员与用户组的 409 %s 说得出是哪一种（规格 G-41）", (code, title) => {
    const text = explainFailure(failure({ status: 409, code }));
    expect(text.title).toBe(title);
    expect(text.detail.length).toBeGreaterThan(6);
    // 护栏的 409 是预期内的失败：说清楚怎么办就好，不带请求号。
    expect(text.requestId).toBeUndefined();
  });

  it("工程域的三个码各有自己的说法（docs/spec/projects.md 错误码表）", () => {
    expect(explainFailure(failure({ status: 409, code: "projects_slug_taken" }))).toEqual({
      title: "短名已被占用",
      detail: "换一个短名再试。",
    });
    expect(explainFailure(failure({ status: 403, code: "projects_forbidden" }))).toEqual({
      title: "权限不够",
      detail: "只有创建者和管理员能改这个工程。",
    });
    const creation = explainFailure(failure({ status: 500, code: "projects_creation_failed" }));
    expect(creation.title).toBe("工程没有建成");
    // 建仓失败是服务器的事，要找管理员，带请求号。
    expect(creation.requestId).toBe("r-1");
    expect(creation.detail).toContain("没有留下");
  });

  it("不认识的 4xx 原样转述服务器的话", () => {
    expect(explainFailure(failure({ status: 409, code: "teapot", message: "我是茶壶" }))).toEqual({
      title: "没有成功",
      detail: "我是茶壶",
      requestId: "r-1",
    });
  });
});

describe("waitingTime", () => {
  it.each([
    [undefined, "稍后"],
    [0, "稍后"],
    [1, "1 秒后"],
    [59, "59 秒后"],
    [60, "1 分钟后"],
    [61, "2 分钟后"],
    [900, "15 分钟后"],
  ] as const)("%s 秒 → %s", (seconds, text) => {
    expect(waitingTime(seconds)).toBe(text);
  });
});

describe("detailsOf", () => {
  const resultWith = (error: unknown) => ({ response: new Response(null, { status: 429 }), error });

  it("从客户端的结果里取出 retryAfterSeconds", () => {
    expect(
      detailsOf(
        resultWith({ error: { code: "auth_locked_out", details: { retryAfterSeconds: 838 } } }),
      ),
    ).toEqual({ retryAfterSeconds: 838 });
  });

  it("没有 details、不是约定的形状、秒数不是数字：都给空的", () => {
    expect(detailsOf(resultWith({ error: { code: "auth_required" } }))).toEqual({});
    expect(detailsOf(resultWith(null))).toEqual({});
    expect(detailsOf(resultWith("Bad Gateway"))).toEqual({});
    expect(detailsOf(resultWith({ error: { details: { retryAfterSeconds: "soon" } } }))).toEqual(
      {},
    );
    expect(
      detailsOf(resultWith({ error: { details: { retryAfterSeconds: Number.NaN } } })),
    ).toEqual({});
  });
});
