import { eventEnvelope, eventName } from "@nexus/contracts";
import { describe, expect, it } from "vitest";
import { projectsErrorCodes } from "./codes.ts";
import {
  PROJECT_CREATED,
  PROJECT_UPDATED,
  projectCreatedPayload,
  projectUpdatedPayload,
} from "./events.ts";
import { projectsContract } from "./routes.ts";

const ID = "30000000-0000-4000-8000-000000000001";
const ACTOR = "10000000-0000-4000-8000-000000000001";

describe("事件名（规格 P-36、事件表）", () => {
  it("两个事件名和规格的事件表逐字一致，都过契约的事件名正则", () => {
    expect([PROJECT_CREATED, PROJECT_UPDATED]).toEqual([
      "projects.project.created",
      "projects.project.updated",
    ]);
    for (const name of [PROJECT_CREATED, PROJECT_UPDATED]) {
      expect(eventName.safeParse(name).success, name).toBe(true);
      // 进得了信封：subject 是工程编号，source 是模块名
      expect(
        eventEnvelope.safeParse({
          type: name,
          source: "projects",
          subject: ID,
          payload: {},
          occurredAt: "2026-11-27T00:00:00.000Z",
          traceId: "trace-1",
        }).success,
        name,
      ).toBe(true);
    }
  });
});

describe("事件的 payload（规格 P-34、P-35）", () => {
  it("建成：键恰好是 projectId、slug、actorId，都是编号或短名", () => {
    const payload = { projectId: ID, slug: "alpha", actorId: ACTOR };
    expect(projectCreatedPayload.safeParse(payload).success).toBe(true);
    // 多一个键、少一个键、值不是编号或短名，都过不了
    expect(projectCreatedPayload.safeParse({ ...payload, root: "/srv/projects" }).success).toBe(
      false,
    );
    expect(projectCreatedPayload.safeParse({ projectId: ID, slug: "alpha" }).success).toBe(false);
    expect(projectCreatedPayload.safeParse({ ...payload, slug: "Alpha" }).success).toBe(false);
    expect(projectCreatedPayload.safeParse({ ...payload, actorId: "alice" }).success).toBe(false);
  });

  it("改了：多一个 changes，只列真变了的键，每个键带 from 和 to", () => {
    const base = { projectId: ID, slug: "alpha", actorId: ACTOR };
    const onlyName = { displayName: { from: "", to: "甲" } };
    const both = { ...onlyName, avatar: { from: "A", to: "" } };
    expect(projectUpdatedPayload.safeParse({ ...base, changes: onlyName }).success).toBe(true);
    expect(projectUpdatedPayload.safeParse({ ...base, changes: both }).success).toBe(true);
    // 一个改动都没有、改动里多一个键、缺 to：都过不了
    expect(projectUpdatedPayload.safeParse({ ...base, changes: {} }).success).toBe(false);
    expect(
      projectUpdatedPayload.safeParse({
        ...base,
        changes: { slug: { from: "a", to: "b" } },
      }).success,
    ).toBe(false);
    expect(
      projectUpdatedPayload.safeParse({ ...base, changes: { displayName: { from: "" } } }).success,
    ).toBe(false);
  });
});

describe("失败码（规格 P-04）", () => {
  it("对外的那张表恰好是规格的三个码，一个不多一个不少", () => {
    // 三个码各自由哪条真路由打出来，在 apps/api 的 projects-*.integration.test.ts 里逐个走了一遍
    expect(Object.values(projectsErrorCodes).sort()).toEqual([
      "projects_creation_failed",
      "projects_forbidden",
      "projects_slug_taken",
    ]);
  });
});

describe("路由声明（规格 P-01）", () => {
  const declared = projectsContract.routes;

  it("恰好四条路由，访问级别都是 user，方法和路径照规格", () => {
    expect(
      declared.map((item) => [item.access, item.route.method.toUpperCase(), item.route.path]),
    ).toEqual([
      ["user", "GET", "/api/v1/projects"],
      ["user", "POST", "/api/v1/projects"],
      ["user", "GET", "/api/v1/projects/{projectId}"],
      ["user", "PATCH", "/api/v1/projects/{projectId}"],
    ]);
    expect(projectsContract.name).toBe("projects");
  });

  // 四条声明的类型是四种形状的并集：取 request 之前先问有没有
  const requestOf = (item: (typeof declared)[number]) =>
    "request" in item.route ? item.route.request : undefined;
  const paramNames = (item: (typeof declared)[number]): string[] => {
    const request = requestOf(item);
    const params = request && "params" in request ? request.params : undefined;
    return Object.keys((params as { shape?: object } | undefined)?.shape ?? {});
  };
  const bodyOf = (item: (typeof declared)[number]): { required?: boolean } | undefined => {
    const request = requestOf(item);
    return request && "body" in request ? request.body : undefined;
  };

  it("路径参数的名字都是 projectId；只有新建和改收请求体，而且是必填的", () => {
    expect(declared.map((item) => paramNames(item))).toEqual([
      [],
      [],
      ["projectId"],
      ["projectId"],
    ]);
    expect(declared.map((item) => bodyOf(item) !== undefined)).toEqual([false, true, false, true]);
    for (const item of declared) {
      const body = bodyOf(item);
      if (body) expect(body.required, item.route.path).toBe(true);
    }
  });

  it("操作名不重复", () => {
    const ids = declared.map((item) => item.route.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["listProjects", "createProject", "getProject", "updateProject"]);
  });
});
