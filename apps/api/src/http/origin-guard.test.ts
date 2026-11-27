import { Hono, type Context } from "hono";
import { describe, expect, it } from "vitest";
import { API_PREFIX, route, type AppEnv } from "@nexus/http-kit";
import { pino } from "pino";
import { authErrorCodes } from "@nexus/identity";
import { originAllowed, originGuard, type OriginCheck } from "./origin-guard.ts";

const BASE: OriginCheck = {
  method: "POST",
  origin: undefined,
  publicOrigin: undefined,
  protocol: "http",
  host: "127.0.0.1:4261",
};
const check = (patch: Partial<OriginCheck>) => originAllowed({ ...BASE, ...patch });

describe("写请求的来源放不放行（规格 I-36、I-37）", () => {
  it("不带 Origin 放行；Origin: null 拒绝", () => {
    expect(check({})).toBe(true);
    expect(check({ origin: "null" })).toBe(false);
    // 带了个空的，也当不成一个地址
    expect(check({ origin: "" })).toBe(false);
    expect(check({ origin: "http://" })).toBe(false);
  });

  it("和请求自己的地址（协议取请求的协议，主机取 Host）一样才放行", () => {
    const same = ["http://127.0.0.1:4261", "HTTP://127.0.0.1:4261", "http://127.0.0.1:4261/"];
    const different = [
      "http://127.0.0.1:4260",
      "http://localhost:4261",
      "https://127.0.0.1:4261",
      "https://evil.example",
      "http://127.0.0.1:4261.evil.example",
    ];
    for (const origin of same) expect(check({ origin }), origin).toBe(true);
    for (const origin of different) expect(check({ origin }), origin).toBe(false);
  });

  it("IPv6 字面量的主机名带方括号，按一个整体比（旧系统按第一个冒号切，会切成陌生的主机）", () => {
    expect(check({ origin: "http://[::1]:4261", host: "[::1]:4261" })).toBe(true);
    expect(check({ origin: "http://[::1]:4260", host: "[::1]:4261" })).toBe(false);
    // 地址解析会把 IPv6 写法归一，全写和缩写是同一个地址
    expect(check({ origin: "http://[0:0:0:0:0:0:0:1]:4261", host: "[::1]:4261" })).toBe(true);
  });

  it("默认端口折算：写了和不写是同一个地址", () => {
    expect(check({ origin: "http://example.com:80", host: "example.com" })).toBe(true);
    expect(
      check({ origin: "https://example.com", protocol: "https", host: "example.com:443" }),
    ).toBe(true);
    expect(
      check({ origin: "https://example.com:443", protocol: "https", host: "example.com:8443" }),
    ).toBe(false);
  });

  it("配了 PUBLIC_ORIGIN 就按它比，不再看请求自己的地址", () => {
    const publicOrigin = "https://nexus.example.com";
    expect(
      check({
        origin: "https://nexus.example.com",
        publicOrigin,
        protocol: "http",
        host: "10.0.0.5:4260",
      }),
    ).toBe(true);
    expect(
      check({
        origin: "http://10.0.0.5:4260",
        publicOrigin,
        protocol: "http",
        host: "10.0.0.5:4260",
      }),
    ).toBe(false);
    expect(check({ origin: "https://nexus.example.com:8443", publicOrigin })).toBe(false);
  });

  it("没配 PUBLIC_ORIGIN、又没有 Host：比不了，不放行", () => {
    expect(check({ origin: "http://127.0.0.1:4261", host: undefined })).toBe(false);
  });

  it("读方法不查，所以别的站点发来的读请求照样放行（规格 I-35）", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(check({ method, origin: "https://evil.example" }), method).toBe(true);
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(check({ method, origin: "https://evil.example" }), method).toBe(false);
    }
  });
});

function memoryLogger() {
  const lines: string[] = [];
  const log = pino({ level: "debug" }, { write: (line: string) => void lines.push(line) });
  return { log, lines };
}

describe("来源校验中间件", () => {
  const echo = route("public", {
    method: "post",
    path: `${API_PREFIX}/echo`,
    responses: { 200: { description: "ok" } },
  });

  function makeApp(publicOrigin: string | undefined) {
    const { log, lines } = memoryLogger();
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("requestId", "trace-1");
      await next();
    });
    app.use(`${API_PREFIX}/*`, originGuard({ publicOrigin, log }));
    app.on("POST", echo.route.path, (c: Context<AppEnv>) => c.json({ ok: true }, 200));
    return { app, lines };
  }

  it("拒绝时回统一的失败形状，403 csrf_origin_mismatch，并在日志里记下两边的值", async () => {
    const { app, lines } = makeApp(undefined);
    const res = await app.request("/api/v1/echo", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "127.0.0.1:4261" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: authErrorCodes.originMismatch,
        message: expect.any(String),
        requestId: "trace-1",
      },
    });
    const logged = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.msg === "来源校验拒绝");
    expect(logged).toMatchObject({
      requestId: "trace-1",
      origin: "https://evil.example",
      expected: "http://127.0.0.1:4261",
    });
  });

  it("不带 Origin、或者 Origin 和自己的地址一样：放行，什么都不记", async () => {
    const { app, lines } = makeApp(undefined);
    // Host 要自己带上：app.request 造出来的 Request 没有 Host（真服务里它由连接那一层加）
    for (const headers of [
      { host: "127.0.0.1:4261" },
      { host: "127.0.0.1:4261", origin: "http://127.0.0.1:4261" },
    ]) {
      const res = await app.request("/api/v1/echo", { method: "POST", headers });
      expect(res.status, JSON.stringify(headers)).toBe(200);
    }
    expect(lines).toEqual([]);
  });

  it("没有 Host 可比的时候不放行：比不了就不放（真服务里 HTTP/1.1 一定带 Host）", async () => {
    const { app } = makeApp(undefined);
    const res = await app.request("/api/v1/echo", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4261" },
    });
    expect(res.status).toBe(403);
  });
});
