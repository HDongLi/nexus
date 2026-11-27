import { SESSION_COOKIE } from "@nexus/http-kit";
import { describe, expect, it } from "vitest";
import { API_INFO, contractSources } from "./contract-sources.ts";
import { buildOpenApiDocument } from "./contract.ts";

/**
 * 契约测试：只读生成的接口文档，不起数据库、不起进程（规格「要求」一节给四种测试划的分工）。
 * 页面那一边只认这份文档，所以文档里多一个字段，页面上就多一样东西。
 */

interface Schema {
  [key: string]: unknown;
}
interface ResponseObject {
  description?: string;
  headers?: Record<string, { description?: string; schema?: Schema }>;
  content?: Record<string, { schema: Schema }>;
}
interface Operation {
  operationId: string;
  "x-auth"?: string;
  security?: unknown;
  requestBody?: { required?: boolean; content: Record<string, { schema: Schema }> };
  responses: Record<string, ResponseObject>;
}

const doc = buildOpenApiDocument(contractSources(), API_INFO);
const IDENTITY_PATHS = [
  "/api/v1/auth/login",
  "/api/v1/auth/me",
  "/api/v1/auth/logout",
  "/api/v1/auth/password",
] as const;

/** 一条路径上的那个操作。契约里没有就是测试写错了，直接说清楚是哪条。 */
function operation(path: string): Operation {
  const item = doc.paths?.[path] as Record<string, unknown> | undefined;
  const op = Object.values(item ?? {}).find(
    (value): value is Operation => typeof value === "object" && value !== null,
  );
  if (op === undefined) throw new Error(`契约里没有 ${path}`);
  return op;
}

const response = (path: string, status: string): ResponseObject | undefined =>
  operation(path).responses[status];

/** 把一份 JSON Schema 里所有「字段名」收出来：属性名、数组元素的、嵌套对象的。 */
function fieldNames(schema: unknown, out: string[] = []): string[] {
  if (typeof schema !== "object" || schema === null) return out;
  if (Array.isArray(schema)) {
    for (const item of schema) fieldNames(item, out);
    return out;
  }
  const record = schema as {
    properties?: Record<string, unknown>;
    items?: unknown;
    additionalProperties?: unknown;
  };
  for (const [name, inner] of Object.entries(record.properties ?? {})) {
    out.push(name);
    fieldNames(inner, out);
  }
  fieldNames(record.items, out);
  fieldNames(record.additionalProperties, out);
  return out;
}

/** 一条路由全部回应里出现过的名字：响应头的，和正文里的字段。 */
function responseNames(path: string): string[] {
  const names: string[] = [];
  for (const item of Object.values(operation(path).responses)) {
    names.push(...Object.keys(item.headers ?? {}));
    for (const media of Object.values(item.content ?? {})) fieldNames(media.schema, names);
  }
  return names;
}

const successBody = (path: string): Schema =>
  response(path, "200")?.content?.["application/json"]?.schema ?? {};
const requestSchema = (path: string): Schema =>
  operation(path).requestBody?.content["application/json"]?.schema ?? {};

describe("身份模块的四条路由（规格 I-01）", () => {
  it("接口文档里恰好有这四条，访问级别和表一致", () => {
    expect(IDENTITY_PATHS.map((path) => operation(path).operationId).sort()).toEqual([
      "changePassword",
      "getMe",
      "login",
      "logout",
    ]);
    expect(IDENTITY_PATHS.map((path) => [path, operation(path)["x-auth"]])).toEqual([
      ["/api/v1/auth/login", "public"],
      ["/api/v1/auth/me", "user"],
      ["/api/v1/auth/logout", "user"],
      ["/api/v1/auth/password", "user"],
    ]);
  });

  it("登录不要求鉴权；后三条带 cookie 鉴权，cookie 的名字就是会话 cookie", () => {
    for (const path of IDENTITY_PATHS) {
      const op = operation(path);
      if (op["x-auth"] === "public") expect(op.security, path).toBeUndefined();
      else expect(op.security, path).toEqual([{ cookieSession: [] }]);
    }
    const schemes = doc.components?.securitySchemes as Record<
      string,
      { type: string; in: string; name: string }
    >;
    expect(schemes.cookieSession).toEqual({ type: "apiKey", in: "cookie", name: SESSION_COOKIE });
    expect(SESSION_COOKIE).toBe("nexus_session");
  });

  it("每条路由声明的状态码，和规格的表一致；写请求都声明了来源校验的 403", () => {
    const statuses = (path: string): string[] => Object.keys(operation(path).responses);
    expect(statuses("/api/v1/auth/login")).toEqual(["200", "400", "401", "403", "429", "500"]);
    expect(statuses("/api/v1/auth/me")).toEqual(["200", "401", "500"]);
    expect(statuses("/api/v1/auth/logout")).toEqual(["200", "401", "403", "500"]);
    expect(statuses("/api/v1/auth/password")).toEqual(["200", "400", "401", "403", "429", "500"]);
  });

  it("请求体是必填的 JSON，字段一个不多一个不少，长度上限照规格（I-02）", () => {
    for (const path of ["/api/v1/auth/login", "/api/v1/auth/password"]) {
      const body = operation(path).requestBody;
      expect(body?.required, path).toBe(true);
      expect(Object.keys(body?.content ?? {}), path).toEqual(["application/json"]);
      expect(requestSchema(path).additionalProperties, path).toBe(false);
    }
    expect(requestSchema("/api/v1/auth/login")).toEqual({
      type: "object",
      properties: {
        username: { type: "string", minLength: 1, maxLength: 64 },
        password: { type: "string", minLength: 1, maxLength: 128 },
      },
      required: ["username", "password"],
      additionalProperties: false,
    });
    const password = requestSchema("/api/v1/auth/password");
    expect(password.required).toEqual(["currentPassword", "newPassword"]);
    for (const field of ["currentPassword", "newPassword"]) {
      expect((password.properties as Record<string, Schema>)[field], field).toEqual({
        type: "string",
        minLength: 1,
        maxLength: 128,
      });
    }
    expect(operation("/api/v1/auth/me").requestBody).toBeUndefined();
    expect(operation("/api/v1/auth/logout").requestBody).toBeUndefined();
  });

  it("登录和我是谁回的 user 恰好是四个键（I-26）", () => {
    for (const path of ["/api/v1/auth/login", "/api/v1/auth/me"]) {
      const schema = successBody(path);
      expect(schema.additionalProperties, path).toBe(false);
      expect(Object.keys(schema.properties as object), path).toEqual(["user"]);
      const user = (schema.properties as Record<string, Schema>).user as Schema;
      expect(user.additionalProperties, path).toBe(false);
      expect(Object.keys(user.properties as object).sort()).toEqual([
        "displayName",
        "id",
        "isAdmin",
        "username",
      ]);
    }
  });

  it("锁定那个回应的 details 里，类型上看得见还要等的秒数（I-14）", () => {
    for (const path of ["/api/v1/auth/login", "/api/v1/auth/password"]) {
      const body = response(path, "429")?.content?.["application/json"]?.schema as Schema;
      const error = (body.properties as Record<string, Schema>).error as Schema;
      const details = (error.properties as Record<string, Schema>).details as Schema;
      expect(details, path).toEqual({
        type: "object",
        properties: { retryAfterSeconds: { type: "integer", minimum: 1, maximum: 900 } },
        required: ["retryAfterSeconds"],
        additionalProperties: false,
      });
    }
  });

  it("下发和清除会话 cookie 的那三条路由，在回应头上写明了", () => {
    const header = (path: string): string | undefined =>
      response(path, "200")?.headers?.["Set-Cookie"]?.description;
    expect(header("/api/v1/auth/login")).toContain("下发会话 cookie");
    expect(header("/api/v1/auth/logout")).toContain("清除会话 cookie");
    expect(header("/api/v1/auth/password")).toContain("下发会话 cookie");
    expect(operation("/api/v1/auth/me").responses["200"]?.headers).toBeUndefined();
  });
});

describe("响应里不出令牌、散列、盐（规格 I-21、I-45）", () => {
  const FORBIDDEN = /password|salt|hash|pwv|token/i;

  it("四条路由的全部回应里，没有名字含这些词的字段，也没有这样的响应头", () => {
    for (const path of IDENTITY_PATHS) {
      const names = responseNames(path);
      expect(names.length, path).toBeGreaterThan(0);
      expect(
        names.filter((name) => FORBIDDEN.test(name)),
        path,
      ).toEqual([]);
    }
  });

  it("成功回应的字段就是这些，没有别的", () => {
    const ok = (path: string): string[] => fieldNames(successBody(path));
    expect(ok("/api/v1/auth/login")).toEqual(["user", "id", "username", "displayName", "isAdmin"]);
    expect(ok("/api/v1/auth/me")).toEqual(["user", "id", "username", "displayName", "isAdmin"]);
    expect(ok("/api/v1/auth/logout")).toEqual(["ok"]);
    expect(ok("/api/v1/auth/password")).toEqual(["ok"]);
  });
});

describe("骨架期「明说没接」的痕迹已经收走（规格 I-05）", () => {
  it("需要登录的接口不再声明 501", () => {
    for (const path of ["/api/v1/system/info", "/api/v1/doc"]) {
      expect(Object.keys(operation(path).responses), path).not.toContain("501");
    }
    expect(JSON.stringify(doc)).not.toContain("auth_not_wired");
  });
});
