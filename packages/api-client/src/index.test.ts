import { describe, expect, it } from "vitest";
import { createApiClient, failureOf } from "./index.ts";

describe("契约客户端", () => {
  it("默认同源：路径原样发出，带凭据，要 JSON", async () => {
    const seen: Request[] = [];
    const api = createApiClient({
      baseUrl: "http://app.test",
      fetch: async (request) => {
        seen.push(request);
        return new Response("{}", { status: 200 });
      },
    });
    await api.GET("/api/v1/system/health");
    expect(seen[0]?.url).toBe("http://app.test/api/v1/system/health");
    expect(seen[0]?.credentials).toBe("include");
    expect(seen[0]?.headers.get("accept")).toBe("application/json");
  });

  it("自定义请求头不会盖掉要 JSON 这一条", async () => {
    let accept: string | null = null;
    const api = createApiClient({
      baseUrl: "http://app.test",
      headers: { "x-locale": "zh-CN" },
      fetch: async (request) => {
        accept = request.headers.get("accept");
        return new Response("{}", { status: 200 });
      },
    });
    await api.GET("/api/v1/system/health");
    expect(accept).toBe("application/json");
  });

  // 2026-11-26: this goes through the real client on purpose. Reading the body a second time from
  // `response` looked fine when tested with a fresh Response, and lost the failure's reason in
  // the browser, because the client had already consumed the body.
  it("经过客户端的失败，原因和请求号都还在", async () => {
    // 样例取的是这个接口现在没登录时的真回应（2026-11-27 身份模块接入后是 401，不再是 501）
    const api = createApiClient({
      baseUrl: "http://app.test",
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { code: "auth_required", message: "请先登录", requestId: "r-1" },
          }),
          { status: 401, headers: { "x-request-id": "r-1" } },
        ),
    });
    const result = await api.GET("/api/v1/system/info");
    expect(result.data).toBeUndefined();
    expect(failureOf(result)).toEqual({
      status: 401,
      code: "auth_required",
      message: "请先登录",
      requestId: "r-1",
    });
  });

  it("回合不是约定形状时也不崩，请求号从响应头拿", async () => {
    const api = createApiClient({
      baseUrl: "http://app.test",
      fetch: async () =>
        new Response("Bad Gateway", {
          status: 502,
          headers: { "x-request-id": "from-header" },
        }),
    });
    const result = await api.GET("/api/v1/system/health");
    expect(failureOf(result)).toEqual({
      status: 502,
      code: "http_502",
      message: "服务器回了 502，没有说明原因",
      requestId: "from-header",
    });
  });
});
