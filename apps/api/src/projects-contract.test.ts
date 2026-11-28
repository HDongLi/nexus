import { describe, expect, it } from "vitest";
import { API_INFO, contractSources } from "./contract-sources.ts";
import { buildOpenApiDocument } from "./contract.ts";

/**
 * 契约测试：只读生成的接口文档，不起数据库、不起进程（规格「要求」一节给四种测试划的分工）。
 * 工程页那一边只认这份文档，所以短名的式子、七个键、`head` 的三个键，都在这里钉住。
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
const COLLECTION = "/api/v1/projects";
const MEMBER = "/api/v1/projects/{projectId}";
/**
 * Project 的七个键，按默认的字符串排序排好，和下面各处 `.sort()` 出来的顺序一个算法。
 * 不手写排好的顺序：默认排序按码元比，大写在小写前面，`createdAt` 排在 `createdById` 前，
 * 照字母读音手写会写反（2026-11-28 交付前实弹）。
 */
const PROJECT_KEYS = [
  "id",
  "slug",
  "displayName",
  "avatar",
  "createdById",
  "createdAt",
  "updatedAt",
].sort();
const SLUG_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";

/** 集合路径上只有一个操作（get 或 post）；成员路径上有 get 和 patch 两个。 */
function operationOf(path: string, method: string): Operation {
  const op = (doc.paths?.[path] as Record<string, unknown> | undefined)?.[method];
  if (op === undefined) throw new Error(`契约里没有 ${method.toUpperCase()} ${path}`);
  return op as Operation;
}
const list = (): Operation => operationOf(COLLECTION, "get");
const create = (): Operation => operationOf(COLLECTION, "post");
const detail = (): Operation => operationOf(MEMBER, "get");
const update = (): Operation => operationOf(MEMBER, "patch");

const success = (op: Operation, status: "200" | "201"): Schema =>
  op.responses[status]?.content?.["application/json"]?.schema ?? {};
const request = (op: Operation): Schema =>
  op.requestBody?.content["application/json"]?.schema ?? {};
const properties = (schema: Schema): Record<string, Schema> =>
  schema.properties as Record<string, Schema>;
const sortedKeys = (schema: Schema): string[] => Object.keys(properties(schema)).sort();
/** 必填字段的名字。 */
const requiredOf = (schema: Schema): string[] => (schema.required as string[] | undefined) ?? [];
/** 一个字段的子 schema。契约里没有就是契约变了，直接说清楚少了哪个。 */
const field = (schema: Schema, name: string): Schema => {
  const inner = properties(schema)[name];
  if (inner === undefined) throw new Error(`契约里没有字段 ${name}`);
  return inner;
};

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

describe("工程模块的四条路由（规格 P-01）", () => {
  it("恰好四条操作，访问级别都是 user，带 cookie 鉴权；/api/v1/projects 底下没有别的路径", () => {
    const four = [list(), create(), detail(), update()];
    expect(four.map((op) => op.operationId)).toEqual([
      "listProjects",
      "createProject",
      "getProject",
      "updateProject",
    ]);
    for (const op of four) {
      expect(op["x-auth"]).toBe("user");
      expect(op.security).toEqual([{ cookieSession: [] }]);
    }
    expect(
      Object.keys(doc.paths ?? {}).filter((path) => path.startsWith("/api/v1/projects")),
    ).toEqual([COLLECTION, MEMBER]);
    expect(doc.tags).toContainEqual({ name: "projects" });
  });

  it("路径参数的名字是 projectId：在路径里、必填、是编号；清单和新建没有参数", () => {
    for (const op of [detail(), update()]) {
      expect(op.parameters, op.operationId).toEqual([
        {
          schema: { type: "string", format: "uuid" },
          required: true,
          name: "projectId",
          in: "path",
        },
      ]);
    }
    expect(list().parameters).toBeUndefined();
    expect(create().parameters).toBeUndefined();
  });

  it("每条路由声明的状态码和设计 02 的契约表一致（401、403 是平台统一的）", () => {
    expect(Object.keys(list().responses)).toEqual(["200", "401", "500"]);
    expect(Object.keys(create().responses)).toEqual(["201", "400", "401", "403", "409", "500"]);
    expect(Object.keys(detail().responses)).toEqual(["200", "401", "404", "500"]);
    expect(Object.keys(update().responses)).toEqual(["200", "400", "401", "403", "404", "500"]);
  });

  it("新建的请求体：必填；短名必填并带着式子；显示名和头像字可省；多一个键不收", () => {
    expect(create().requestBody?.required).toBe(true);
    const body = request(create());
    expect(body.additionalProperties).toBe(false);
    expect(Object.keys(properties(body))).toEqual(["slug", "displayName", "avatar"]);
    expect(body.required).toEqual(["slug"]);
    expect(field(body, "slug")).toEqual({ type: "string", pattern: SLUG_PATTERN });
  });

  it("改的请求体：只有显示名和头像字两个可选的键，没有 slug；至少带一个这条规则写在说明里", () => {
    expect(update().requestBody?.required).toBe(true);
    const body = request(update());
    expect(body.additionalProperties).toBe(false);
    expect(Object.keys(properties(body))).toEqual(["displayName", "avatar"]);
    expect(body.required).toBeUndefined();
    expect(update().description).toContain("至少带一个");
  });

  it("Project 恰好七个键、都是必填的字符串，时间带时区", () => {
    // 清单那一层是数组：每个元素的 schema 在 items 上
    const shapes: Array<[string, Schema]> = [
      ["清单", field(success(list(), "200"), "projects").items as Schema],
      ["新建", field(success(create(), "201"), "project")],
      ["改", field(success(update(), "200"), "project")],
    ];
    for (const [label, project] of shapes) {
      expect(project.additionalProperties, label).toBe(false);
      expect(sortedKeys(project), label).toEqual(PROJECT_KEYS);
      expect(requiredOf(project).sort(), label).toEqual(PROJECT_KEYS);
      expect(fieldNames(project).sort(), label).toEqual(PROJECT_KEYS);
      for (const name of PROJECT_KEYS) {
        expect(field(project, name).type, `${label}.${name}`).toBe("string");
      }
      expect(field(project, "createdAt").format, label).toBe("date-time");
      expect(field(project, "updatedAt").format, label).toBe("date-time");
    }
  });

  it("详情：Project 加一个 head，head 恰好三个键", () => {
    const body = success(detail(), "200");
    expect(Object.keys(properties(body))).toEqual(["project"]);
    const project = field(body, "project");
    expect(project.additionalProperties).toBe(false);
    const withHead = [...PROJECT_KEYS, "head"].sort();
    expect(sortedKeys(project)).toEqual(withHead);
    expect(requiredOf(project).sort()).toEqual(withHead);
    // fieldNames 把嵌套对象的名字（head 本身）和它里面的键一起数进来
    expect(fieldNames(project).sort()).toEqual(
      [...PROJECT_KEYS, "head", "commitId", "committedAt", "subject"].sort(),
    );
    const head = field(project, "head");
    expect(head.additionalProperties).toBe(false);
    expect(Object.keys(properties(head))).toEqual(["commitId", "committedAt", "subject"]);
    expect(requiredOf(head).sort()).toEqual(["commitId", "committedAt", "subject"].sort());
    expect(field(head, "committedAt").format).toBe("date-time");
  });
});

describe("契约里不出服务器上的路径（规格 P-05）", () => {
  it("四条路由的全部回应里，没有名字像路径的字段", () => {
    for (const op of [list(), create(), detail(), update()]) {
      for (const [status, response] of Object.entries(op.responses)) {
        for (const media of Object.values(response.content ?? {})) {
          expect(
            fieldNames(media.schema).filter((name) => /root|path|dir|folder|repo/i.test(name)),
            `${op.operationId} ${status}`,
          ).toEqual([]);
        }
      }
    }
  });
});
