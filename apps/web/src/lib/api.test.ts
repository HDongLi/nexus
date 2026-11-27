import { describe, expect, it } from "vitest";
import { callApi } from "./api.ts";
import { NETWORK_FAILURE } from "./failure.ts";

const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("callApi：把两种失败并成一种", () => {
  it("成功时给数据", async () => {
    const outcome = await callApi(async () => ({
      response: response(200, { ok: true }),
      data: { ok: true },
    }));
    expect(outcome).toEqual({ ok: true, data: { ok: true } });
  });

  it("接口回了错误：翻出码、说明、请求号和附加的秒数", async () => {
    const result = {
      response: response(
        429,
        {
          error: {
            code: "auth_locked_out",
            message: "x",
            requestId: "r-9",
            details: { retryAfterSeconds: 300 },
          },
        },
        { "x-request-id": "r-9" },
      ),
      error: {
        error: {
          code: "auth_locked_out",
          message: "这个用户名试错次数太多",
          requestId: "r-9",
          details: { retryAfterSeconds: 300 },
        },
      },
    };
    expect(await callApi(async () => result)).toEqual({
      ok: false,
      failure: {
        status: 429,
        code: "auth_locked_out",
        message: "这个用户名试错次数太多",
        requestId: "r-9",
      },
      details: { retryAfterSeconds: 300 },
    });
  });

  it("没有附加信息的错误，details 是空的", async () => {
    const result = {
      response: response(401, {
        error: { code: "auth_required", message: "请先登录", requestId: "r-1" },
      }),
      error: { error: { code: "auth_required", message: "请先登录", requestId: "r-1" } },
    };
    expect(await callApi(async () => result)).toEqual({
      ok: false,
      failure: { status: 401, code: "auth_required", message: "请先登录", requestId: "r-1" },
      details: {},
    });
  });

  it("浏览器没连上，fetch 直接抛：做成同一个形状，不往上抛异常", async () => {
    const outcome = await callApi(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(outcome).toEqual({ ok: false, failure: NETWORK_FAILURE, details: {} });
    expect(NETWORK_FAILURE.code).toBe("network_error");
  });
});
