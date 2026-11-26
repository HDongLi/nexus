import type { ApiFailure } from "@nexus/api-client";
import { describe, expect, it } from "vitest";
import { explainFailure } from "./failure.ts";

const failure = (patch: Partial<ApiFailure>): ApiFailure => ({
  status: 500,
  code: "internal_error",
  message: "服务器内部错误",
  requestId: "r-1",
  ...patch,
});

describe("把失败翻成给人看的话", () => {
  it("认识的错误码给出专门的标题和下一步", () => {
    expect(explainFailure(failure({ status: 501, code: "auth_not_wired" }))).toEqual({
      title: "需要登录",
      detail: "身份模块还没有接入，这个接口暂时用不了。",
    });
  });

  it("不认识的 5xx 说清楚是服务器的问题，并指向请求号", () => {
    const text = explainFailure(failure({ code: "something_new" }));
    expect(text.title).toBe("服务器出了问题");
    expect(text.detail).toMatch(/请求号/);
  });

  it("参数不合法时原样转述服务器的说明", () => {
    expect(
      explainFailure(failure({ status: 400, code: "invalid_request", message: "名字太长" })).detail,
    ).toBe("名字太长");
  });
});
