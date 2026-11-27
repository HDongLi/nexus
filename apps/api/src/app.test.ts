import { fail, API_PREFIX, bind, errors, json, route } from "@nexus/http-kit";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp, type AppDeps } from "./app.ts";
import { API_INFO, contractSources } from "./contract-sources.ts";
import { buildOpenApiDocument } from "./contract.ts";
import type { AccessVerifier } from "./http/access-guard.ts";

const ping = route("public", {
  method: "get",
  path: `${API_PREFIX}/ping`,
  responses: { 200: json(z.object({ pong: z.boolean() }), "pong") },
});

const secret = route("admin", {
  method: "get",
  path: `${API_PREFIX}/secret`,
  responses: { 200: json(z.object({ ok: z.boolean() }), "ok"), ...errors(401, 403) },
});

const echo = route("public", {
  method: "get",
  path: `${API_PREFIX}/echo/{name}`,
  request: { query: z.object({ times: z.coerce.number().int() }) },
  responses: { 200: json(z.object({ text: z.string() }), "重复几遍"), ...errors(400) },
});

const boom = route("public", {
  method: "get",
  path: `${API_PREFIX}/boom`,
  responses: { 200: json(z.object({ never: z.boolean() }), "不会到这") },
});

function fakeModule(): AppDeps["modules"][number] {
  return {
    name: "fake",
    bindings: [
      bind(ping, (c) => c.json({ pong: true }, 200)),
      bind(secret, (c) => c.json({ ok: true }, 200)),
      bind(echo, (c) =>
        c.json({ text: c.req.param("name").repeat(c.req.valid("query").times) }, 200),
      ),
      bind(boom, () => {
        throw new Error("处理函数炸了");
      }),
    ],
  };
}

/** 把日志收进数组里，测试好断言「出错时留了证据」。 */
function memoryLogger() {
  const lines: string[] = [];
  const log = pino({ level: "debug" }, { write: (line: string) => void lines.push(line) });
  return { log, lines };
}

const allowAll: AccessVerifier = async () => undefined;

function makeApp(verify: AccessVerifier = allowAll) {
  const { log, lines } = memoryLogger();
  const { app } = createApp({ log, modules: [fakeModule()], verify });
  return { app, lines };
}

describe("应用装配与访问闸", () => {
  it("公开路由直接可达，响应头带回请求号", async () => {
    const { app } = makeApp();
    const res = await app.request(`${API_PREFIX}/ping`, {
      headers: { "x-request-id": "trace-42" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("trace-42");
    expect(await res.json()).toEqual({ pong: true });
  });

  it("调用方没带请求号就自己生成一个", async () => {
    const { app } = makeApp();
    const res = await app.request(`${API_PREFIX}/ping`);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("路径参数和查询参数都是校验过的", async () => {
    const { app } = makeApp();
    const res = await app.request(`${API_PREFIX}/echo/ha?times=3`);
    expect(await res.json()).toEqual({ text: "hahaha" });
  });

  it("查询参数不合法回 400，并说清哪一项不对", async () => {
    const { app } = makeApp();
    const res = await app.request(`${API_PREFIX}/echo/ha?times=many`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details: { issues: { path: string }[] } };
    };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.issues[0]?.path).toBe("times");
  });

  it("需要权限的路由会问验证器，验证器说不行就不行", async () => {
    const asked: string[] = [];
    const deny: AccessVerifier = async (c, level) => {
      asked.push(level);
      return fail(c, 403, "forbidden", "你不可以");
    };
    const { app } = makeApp(deny);
    const res = await app.request(`${API_PREFIX}/secret`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    expect(asked).toEqual(["admin"]);
  });

  it("验证器放行时，处理函数照常执行", async () => {
    const { app } = makeApp();
    const res = await app.request(`${API_PREFIX}/secret`);
    expect(res.status).toBe(200);
  });

  it("没有的路径回 404，错误形状里有请求号", async () => {
    const { app } = makeApp();
    const res = await app.request(`${API_PREFIX}/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("not_found");
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("路径在但方法不对，也算没有", async () => {
    const { app } = makeApp();
    expect((await app.request(`${API_PREFIX}/ping`, { method: "post" })).status).toBe(404);
  });

  it("处理函数抛了异常：回 500，不漏内部细节，日志里有堆栈和请求号", async () => {
    const { app, lines } = makeApp();
    const res = await app.request(`${API_PREFIX}/boom`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).not.toContain("炸了");
    const logged = lines
      .map((line) => JSON.parse(line) as { requestId?: string; err?: { message: string } })
      .find((entry) => entry.err);
    expect(logged?.requestId).toBe(body.error.requestId);
    expect(logged?.err?.message).toBe("处理函数炸了");
  });

  it("探活请求的日志降到 debug，别的请求记 info", async () => {
    const { app, lines } = makeApp();
    await app.request(`${API_PREFIX}/ping`);
    const entry = lines
      .map((line) => JSON.parse(line) as { msg: string; level: number })
      .find((e) => e.msg === "request");
    expect(entry?.level).toBe(30);
  });
});

describe("契约文档", () => {
  const doc = buildOpenApiDocument(contractSources(), API_INFO);

  it("每个操作都标了访问级别；不是公开的就带鉴权方式", () => {
    const operations = Object.values(doc.paths ?? {}).flatMap((item) => Object.values(item));
    expect(operations.length).toBeGreaterThan(0);
    for (const raw of operations) {
      const op = raw as Record<string, unknown>;
      expect(["public", "user", "admin"]).toContain(op["x-auth"]);
      if (op["x-auth"] === "public") expect(op.security).toBeUndefined();
      else expect(op.security).toEqual([{ cookieSession: [] }]);
    }
  });

  it("操作名不重复", () => {
    const ids = Object.values(doc.paths ?? {})
      .flatMap((item) => Object.values(item))
      .map((raw) => (raw as { operationId: string }).operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("写进契约包的那份文档和代码里的一致", async () => {
    const committed = JSON.parse(
      await readFile(
        join(
          dirname(fileURLToPath(import.meta.resolve("@nexus/api-client/package.json"))),
          "openapi.json",
        ),
        "utf8",
      ),
    ) as unknown;
    expect(committed).toEqual(doc);
  });
});
