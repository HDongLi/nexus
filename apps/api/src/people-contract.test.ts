import { describe, expect, it } from "vitest";
import { API_INFO, contractSources } from "./contract-sources.ts";
import { buildOpenApiDocument } from "./contract.ts";

/**
 * 契约测试：十七条人员路由（规格 G-01 到 G-05）。只读生成的接口文档，不起数据库、不起进程。
 * 十五条归身份模块，一个组的可见工程那两条归工程模块（G-31）。
 */

interface Schema {
  [key: string]: unknown;
}
interface Operation {
  operationId: string;
  description?: string;
  "x-auth"?: string;
  security?: unknown;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: Schema }>;
  requestBody?: { required?: boolean; content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
}

const doc = buildOpenApiDocument(contractSources(), API_INFO);

/** 规格的路由表：方法、路径、访问级别、参数名。十五 + 二，恰好十七条。 */
const ROUTES: Array<[string, string, string, string | undefined]> = [
  ["get", "/api/v1/users", "admin", undefined],
  ["post", "/api/v1/users", "admin", undefined],
  ["get", "/api/v1/users/{userId}", "admin", "userId"],
  ["patch", "/api/v1/users/{userId}", "admin", "userId"],
  ["post", "/api/v1/users/{userId}/password", "admin", "userId"],
  ["post", "/api/v1/users/{userId}/disable", "admin", "userId"],
  ["post", "/api/v1/users/{userId}/enable", "admin", "userId"],
  ["delete", "/api/v1/users/{userId}", "admin", "userId"],
  ["get", "/api/v1/people", "user", undefined],
  ["get", "/api/v1/groups", "admin", undefined],
  ["post", "/api/v1/groups", "admin", undefined],
  ["get", "/api/v1/groups/{groupId}", "admin", "groupId"],
  ["patch", "/api/v1/groups/{groupId}", "admin", "groupId"],
  ["put", "/api/v1/groups/{groupId}/members", "admin", "groupId"],
  ["delete", "/api/v1/groups/{groupId}", "admin", "groupId"],
  ["get", "/api/v1/groups/{groupId}/projects", "admin", "groupId"],
  ["put", "/api/v1/groups/{groupId}/projects", "admin", "groupId"],
];

const methodOf = (path: string, method: string): Operation => {
  const op = (doc.paths?.[path] as Record<string, unknown> | undefined)?.[method];
  if (op === undefined) throw new Error(`契约里没有 ${method.toUpperCase()} ${path}`);
  return op as Operation;
};

const success = (path: string, method: string, status: string): Schema =>
  methodOf(path, method).responses[status]?.content?.["application/json"]?.schema ?? {};
const request = (path: string, method: string): Schema =>
  methodOf(path, method).requestBody?.content["application/json"]?.schema ?? {};
const properties = (schema: Schema): Record<string, Schema> =>
  (schema.properties as Record<string, Schema>) ?? {};

/** 一份 JSON Schema 里所有「字段名」：属性名、数组元素的、嵌套对象的。 */
function fieldNames(schema: unknown, out: string[] = []): string[] {
  if (typeof schema !== "object" || schema === null) return out;
  const record = schema as { properties?: Record<string, unknown>; items?: unknown };
  for (const [name, inner] of Object.entries(record.properties ?? {})) {
    out.push(name);
    fieldNames(inner, out);
  }
  fieldNames(record.items, out);
  return out;
}

describe("十七条路由的访问级别与路径参数名（规格 G-01）", () => {
  it("恰好十七条，x-auth 与规格的表一致，带 cookie 鉴权", () => {
    expect(
      ROUTES.map(([method, path]) => [method, path, methodOf(path, method)["x-auth"]]),
    ).toEqual(ROUTES.map(([method, path, level]) => [method, path, level]));
    for (const [method, path] of ROUTES) {
      expect(methodOf(path, method).security).toEqual([{ cookieSession: [] }]);
    }
  });

  it("users 下的路径参数名都是 userId，groups 下的都是 groupId；集合路径没有参数", () => {
    for (const [method, path, , param] of ROUTES) {
      const parameters = methodOf(path, method).parameters ?? [];
      if (param === undefined) {
        expect(parameters, `${method} ${path}`).toEqual([]);
        continue;
      }
      expect(parameters, `${method} ${path}`).toEqual([
        { schema: { type: "string", format: "uuid" }, required: true, name: param, in: "path" },
      ]);
    }
  });
});

describe("请求体的形状（规格 G-02）", () => {
  it("一律是严格对象：多一个键不收；改号和建号按规格的键", () => {
    const create = request("/api/v1/users", "post");
    expect(create.additionalProperties).toBe(false);
    expect(Object.keys(properties(create))).toEqual([
      "username",
      "password",
      "displayName",
      "isAdmin",
    ]);
    expect(create.required).toEqual(["username", "password"]);

    const update = request("/api/v1/users/{userId}", "patch");
    expect(update.additionalProperties).toBe(false);
    expect(Object.keys(properties(update))).toEqual(["displayName", "isAdmin"]);
    // 至少带一个：description 里说得清楚（规格 G-02 的「至少带一个」按规格）
    expect(methodOf("/api/v1/users/{userId}", "patch").description).toContain("至少带一个");

    const reset = request("/api/v1/users/{userId}/password", "post");
    expect(Object.keys(properties(reset))).toEqual(["newPassword"]);
    expect(properties(reset).newPassword).toEqual({ type: "string", minLength: 1, maxLength: 128 });

    const createGroup = request("/api/v1/groups", "post");
    expect(Object.keys(properties(createGroup))).toEqual(["name", "memberIds"]);

    const members = request("/api/v1/groups/{groupId}/members", "put");
    expect(Object.keys(properties(members))).toEqual(["userIds"]);

    const projects = request("/api/v1/groups/{groupId}/projects", "put");
    expect(Object.keys(properties(projects))).toEqual(["projectIds"]);
  });

  it("三个编号数组都是数组，元素是编号；重复的编号拦在运行时（zod 的 refine 不进契约，集成测试钉住）", () => {
    for (const [path, method, field] of [
      ["/api/v1/groups", "post", "memberIds"],
      ["/api/v1/groups/{groupId}/members", "put", "userIds"],
      ["/api/v1/groups/{groupId}/projects", "put", "projectIds"],
    ] as const) {
      const fieldSchema = properties(request(path, method))[field] as Schema;
      expect(fieldSchema.type, `${method} ${path}`).toBe("array");
      expect((fieldSchema.items as Schema).format, `${method} ${path}`).toBe("uuid");
    }
  });

  it("用户名和组名的规则写进了契约：用户名带式子，组名带说明", () => {
    const username = properties(request("/api/v1/users", "post")).username as Schema;
    expect(username.pattern).toBe("^[A-Za-z0-9_-]{1,64}$");
    const name = properties(request("/api/v1/groups", "post")).name as Schema;
    expect(String(name.description)).toContain("64");
  });
});

describe("回应的形状（规格 G-05、G-06、G-07）", () => {
  it("Account 恰好七个键；people 的每条恰好四个键；Group 恰好五个键", () => {
    const accountKeys = [
      "id",
      "username",
      "displayName",
      "isAdmin",
      "isDisabled",
      "createdAt",
      "passwordChangedAt",
    ].sort();
    // 人员清单那一层是数组（另见下一条）；单条的路由都回 { account }
    for (const [method, path, status] of [
      ["post", "/api/v1/users", "201"],
      ["get", "/api/v1/users/{userId}", "200"],
      ["patch", "/api/v1/users/{userId}", "200"],
      ["post", "/api/v1/users/{userId}/disable", "200"],
      ["post", "/api/v1/users/{userId}/enable", "200"],
    ] as const) {
      const account = properties(success(path, method, status)).account as Schema;
      expect(account.additionalProperties, `${method} ${path}`).toBe(false);
      expect(Object.keys(properties(account)).sort(), `${method} ${path}`).toEqual(accountKeys);
    }

    const person = properties(success("/api/v1/people", "get", "200")).people as Schema;
    expect(Object.keys(properties((person.items as Schema) ?? {})).sort(), "people").toEqual([
      "displayName",
      "id",
      "isAdmin",
      "username",
    ]);

    // 人员清单的每条也恰好七个键（规格 G-06）
    const accounts = properties(success("/api/v1/users", "get", "200")).accounts as Schema;
    expect((accounts.items as Schema).additionalProperties).toBe(false);
    expect(Object.keys(properties((accounts.items as Schema) ?? {})).sort()).toEqual(accountKeys);

    const groupKeys = ["id", "name", "memberIds", "createdAt", "updatedAt"].sort();
    for (const [method, path, status] of [
      ["post", "/api/v1/groups", "201"],
      ["get", "/api/v1/groups/{groupId}", "200"],
      ["patch", "/api/v1/groups/{groupId}", "200"],
      ["put", "/api/v1/groups/{groupId}/members", "200"],
    ] as const) {
      const group = properties(success(path, method, status)).group as Schema;
      expect(group.additionalProperties, `${method} ${path}`).toBe(false);
      expect(Object.keys(properties(group)).sort(), `${method} ${path}`).toEqual(groupKeys);
    }

    // 用户组清单的每条也恰好五个键（规格 G-01 的表）
    const groups = properties(success("/api/v1/groups", "get", "200")).groups as Schema;
    expect((groups.items as Schema).additionalProperties).toBe(false);
    expect(Object.keys(properties((groups.items as Schema) ?? {})).sort()).toEqual(groupKeys);

    for (const [method, path] of [
      ["get", "/api/v1/groups/{groupId}/projects"],
      ["put", "/api/v1/groups/{groupId}/projects"],
    ] as const) {
      const body = properties(success(path, method, "200"));
      expect(Object.keys(body), `${method} ${path}`).toEqual(["projectIds"]);
    }
  });

  it("删号、删组、重置口令成功都回 { ok: true }", () => {
    for (const [method, path] of [
      ["post", "/api/v1/users/{userId}/password"],
      ["delete", "/api/v1/users/{userId}"],
      ["delete", "/api/v1/groups/{groupId}"],
    ] as const) {
      const body = success(path, method, "200");
      expect(Object.keys(properties(body)), `${method} ${path}`).toEqual(["ok"]);
    }
  });
});

describe("响应里不出凭据字段（规格 G-05）", () => {
  const FORBIDDEN = /passwordHash|passwordSalt|password|salt|hash|pwv|token/i;

  it("十七条路由的全部回应里，没有名字含这些词的字段（passwordChangedAt 是时间，不算）", () => {
    for (const [method, path] of ROUTES) {
      const op = methodOf(path, method);
      const names: string[] = [];
      for (const response of Object.values(op.responses)) {
        for (const media of Object.values(response.content ?? {})) fieldNames(media.schema, names);
      }
      expect(names.length, `${method} ${path}`).toBeGreaterThan(0);
      expect(
        names.filter((name) => name !== "passwordChangedAt" && FORBIDDEN.test(name)),
        `${method} ${path}`,
      ).toEqual([]);
    }
  });

  it("Account 里带着 passwordChangedAt：最近改密时间是时间，可以有（规格 G-05）", () => {
    const accounts = properties(success("/api/v1/users", "get", "200")).accounts as Schema;
    expect(Object.keys(properties((accounts.items as Schema) ?? {}))).toContain(
      "passwordChangedAt",
    );
  });
});
