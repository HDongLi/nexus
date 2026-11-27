import {
  API_PREFIX,
  bind,
  currentUser,
  errors,
  fail,
  json,
  requireUser,
  route,
} from "@nexus/http-kit";
import { HTTPException } from "hono/http-exception";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp, type AppDeps } from "./app.ts";
import type { AccessVerifier } from "./http/access-guard.ts";

/**
 * 应用层为「带请求体的路由」补的三样东西（2026-11-27，身份模块接入时实测出来的）：
 * 正文不是 JSON、媒体类型不对时要回统一的失败形状；框架抛的 HTTPException 不当成服务器故障；
 * 要登录的路由上没有当前用户是接线错误。这里用一个假模块验它们，不碰数据库。
 */

const ALICE = {
  id: "10000000-0000-4000-8000-000000000001",
  username: "alice",
  displayName: "Alice",
  isAdmin: true,
};

/** 一条带 JSON 请求体的路由，要登录。 */
const submit = route("user", {
  method: "post",
  path: `${API_PREFIX}/submit`,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.strictObject({ name: z.string().min(1) }) } },
    },
  },
  responses: { 200: json(z.strictObject({ name: z.string() }), "收下了"), ...errors(400, 401) },
});

/** 处理函数直接取当前用户。 */
const whoami = route("user", {
  method: "get",
  path: `${API_PREFIX}/whoami`,
  responses: { 200: json(currentUser, "当前用户"), ...errors(401) },
});

/** 处理函数抛一个框架的 HTTPException。 */
const teapot = route("public", {
  method: "get",
  path: `${API_PREFIX}/teapot`,
  responses: { 200: json(z.object({ never: z.boolean() }), "不会到这") },
});

/** 处理函数抛一个 5xx 的 HTTPException：这是它自己报的故障。 */
const broken = route("public", {
  method: "get",
  path: `${API_PREFIX}/broken`,
  responses: { 200: json(z.object({ never: z.boolean() }), "不会到这") },
});

/** 不收请求体的公开路由。 */
const ping = route("public", {
  method: "get",
  path: `${API_PREFIX}/ping`,
  responses: { 200: json(z.object({ pong: z.boolean() }), "pong") },
});

function fakeModule(): AppDeps["modules"][number] {
  return {
    name: "fake",
    bindings: [
      bind(submit, (c) => c.json({ name: c.req.valid("json").name }, 200)),
      bind(whoami, (c) => c.json(requireUser(c), 200)),
      bind(ping, (c) => c.json({ pong: true }, 200)),
      bind(teapot, () => {
        throw new HTTPException(418, { message: "short and stout" });
      }),
      bind(broken, () => {
        throw new HTTPException(503, { message: "upstream is down" });
      }),
    ],
  };
}

const allowAll: AccessVerifier = async () => undefined;
const denyAll: AccessVerifier = async (c) => fail(c, 401, "auth_required", "请先登录");
/** 访问闸放行，并把一个人放进上下文。 */
const asAlice: AccessVerifier = async (c) => {
  c.set("user", ALICE);
  return undefined;
};

function makeApp(verify: AccessVerifier = allowAll) {
  const lines: string[] = [];
  const log = pino({ level: "debug" }, { write: (line: string) => void lines.push(line) });
  const { app } = createApp({ log, modules: [fakeModule()], verify });
  // 每次调用都重新读：日志是在请求处理当中才写下的
  const entries = (): Record<string, unknown>[] =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { app, entries };
}

const SUBMIT = `${API_PREFIX}/submit`;
const post = (
  app: ReturnType<typeof makeApp>["app"],
  headers: Record<string, string>,
  body?: string,
) =>
  app.request(
    SUBMIT,
    body === undefined ? { method: "POST", headers } : { method: "POST", headers, body },
  );

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("带请求体的路由：正文不合形状一律回 400 invalid_request", () => {
  it("正文不是合法的 JSON：统一的失败形状，带请求号", async () => {
    const { app } = makeApp();
    const res = await post(
      app,
      { "content-type": "application/json", "x-request-id": "trace-1" },
      "{",
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "invalid_request", requestId: "trace-1" },
    });
  });

  it("标了 JSON 却没有正文：同样 400", async () => {
    const { app } = makeApp();
    const res = await post(app, { "content-type": "application/json" });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("invalid_request");
  });

  it("没标成 JSON：400，不是框架的 415，更不是 500（契约里这些路由只声明了 400）", async () => {
    const { app, entries } = makeApp();
    const res = await post(app, { "content-type": "text/plain" }, JSON.stringify({ name: "x" }));
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("invalid_request");
    expect(entries().some((entry) => entry.msg === "请求处理失败")).toBe(false);
  });

  it("正文和声明对得上：处理函数读到的是校验过的值", async () => {
    const { app } = makeApp();
    const res = await post(
      app,
      { "content-type": "application/json; charset=utf-8" },
      JSON.stringify({ name: "nexus" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "nexus" });
  });

  it("字段不合形状：400，并说清哪一项不对；多出来的键也不收", async () => {
    const { app } = makeApp();
    const empty = await post(
      app,
      { "content-type": "application/json" },
      JSON.stringify({ name: "" }),
    );
    expect(empty.status).toBe(400);
    const body = (await empty.json()) as { error: { details: { issues: { path: string }[] } } };
    expect(body.error.details.issues[0]?.path).toBe("name");
    const extra = await post(
      app,
      { "content-type": "application/json" },
      JSON.stringify({ name: "x", more: 1 }),
    );
    expect(extra.status).toBe(400);
  });

  it("需要登录的路由，没登录就先回 401，不去读正文", async () => {
    const { app } = makeApp(denyAll);
    expect((await post(app, { "content-type": "application/json" }, "{")).status).toBe(401);
  });

  it("没声明请求体的路由不受影响", async () => {
    const { app } = makeApp();
    const res = await app.request(`${API_PREFIX}/ping`, { method: "POST", body: "{" });
    expect(res.status).toBe(404);
  });
});

describe("框架抛出的 HTTPException 不是服务器的错", () => {
  it("照它给的状态码回统一的形状，记一条警告，不记成故障", async () => {
    const { app, entries } = makeApp();
    const res = await app.request(`${API_PREFIX}/teapot`, {
      headers: { "x-request-id": "trace-9" },
    });
    expect(res.status).toBe(418);
    expect(await res.json()).toMatchObject({
      error: {
        code: "invalid_request",
        requestId: "trace-9",
        details: { reason: "short and stout" },
      },
    });
    expect(entries().some((entry) => entry.msg === "请求处理失败")).toBe(false);
    expect(entries().find((entry) => entry.msg === "请求被拒绝")).toMatchObject({
      requestId: "trace-9",
      status: 418,
    });
  });

  it("5xx 的 HTTPException 是故障：回 500 internal_error，不回成「请求不合法」，也不把它的话带给页面", async () => {
    const { app, entries } = makeApp();
    const res = await app.request(`${API_PREFIX}/broken`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).not.toContain("upstream is down");
    expect(entries().find((entry) => entry.msg === "请求处理失败")).toMatchObject({
      err: { message: "upstream is down" },
    });
  });
});

describe("取当前用户", () => {
  it("要登录的路由上，处理函数拿到的是访问闸放进来的人", async () => {
    const { app } = makeApp(asAlice);
    const res = await app.request(`${API_PREFIX}/whoami`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ALICE);
  });

  it("上下文里没有当前用户就直接抛：这是接线错误，回 500 并留下证据，不说成「没登录」", async () => {
    const { app, entries } = makeApp(allowAll);
    const res = await app.request(`${API_PREFIX}/whoami`);
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe("internal_error");
    const logged = entries().find((entry) => entry.msg === "请求处理失败");
    expect(logged?.err).toMatchObject({ message: expect.stringContaining("没有当前用户") });
  });

  it("访问闸真说不行的时候，处理函数根本不跑", async () => {
    const { app } = makeApp(denyAll);
    expect((await app.request(`${API_PREFIX}/whoami`)).status).toBe(401);
  });

  it("处理函数既能回声明过的回应，也能回 fail() 的 Response（类型上）", () => {
    // 这一条是给编译器看的：bind 的签名要是又把失败回应挡在外面，这个文件就编不过。
    // 只装配，不调用。
    const binding = bind(ping, (c) =>
      c.req.query("boom") ? fail(c, 400, "invalid_request", "x") : c.json({ pong: true }, 200),
    );
    expect(binding.access).toBe("public");
    expect(binding.route.path).toBe(`${API_PREFIX}/ping`);
  });
});
