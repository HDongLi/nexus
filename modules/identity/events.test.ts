import { eventName, eventEnvelope } from "@nexus/contracts";
import { describe, expect, it } from "vitest";
import type { Executor } from "@nexus/db";
import { createEventLog, type EventRepo, type NewEvent } from "@nexus/event-log";
import type { ZodType } from "zod";
import {
  LOGIN_FAILED,
  LOGIN_SUCCEEDED,
  LOGOUT,
  PASSWORD_CHANGED,
  USER_CREATED,
  loginFailedPayload,
  loginSucceededPayload,
  logoutPayload,
  passwordChangedPayload,
} from "./events.ts";
import { authErrorCodes } from "./codes.ts";
import { identityContract } from "./routes.ts";

const EVENT_NAMES = [LOGIN_SUCCEEDED, LOGIN_FAILED, LOGOUT, PASSWORD_CHANGED, USER_CREATED];
const ALICE_ID = "10000000-0000-4000-8000-000000000001";

describe("事件名", () => {
  it("五个事件名和规格的事件表逐字一致，都过契约的事件名正则（I-39、I-42）", () => {
    expect([...EVENT_NAMES].sort()).toEqual([
      "identity.login.failed",
      "identity.login.succeeded",
      "identity.logout",
      "identity.password.changed",
      "identity.user.created",
    ]);
    for (const name of EVENT_NAMES) {
      expect(eventName.safeParse(name).success, name).toBe(true);
      // 进得了信封
      expect(
        eventEnvelope.safeParse({
          type: name,
          source: "identity",
          subject: "alice",
          payload: {},
          occurredAt: "2026-11-27T00:00:00.000Z",
        }).success,
        name,
      ).toBe(true);
    }
  });

  it("四段的名字也合法（人员规格的 identity.user.password.reset，2026-11-28 放宽）；两段的照旧合法", () => {
    for (const name of [
      "system.started",
      "issue-tracker.opened",
      "a.b",
      "identity.user.password.reset",
      "projects.visibility.changed",
    ]) {
      expect(eventName.safeParse(name).success, name).toBe(true);
    }
    for (const name of [
      "started",
      "identity",
      "Identity.login.succeeded",
      "identity.Login",
      "identity.login.Succeeded",
      "a.b.c.d.e",
      "a..b",
      "a.b.",
      ".a.b",
      "a1.b2.c3.",
    ]) {
      expect(eventName.safeParse(name).success, name).toBe(false);
    }
  });

  it("带三段名字的事件能真的经事件日志发出去（信封认它）", async () => {
    const inserted: unknown[] = [];
    const log = createEventLog({
      db: {} as never,
      repo: {
        insert: async (_ex: Executor, row: NewEvent) => {
          inserted.push(row);
          return { ...row, id: 1 };
        },
        list: async () => [],
      } as unknown as EventRepo,
    });
    const record = await log.emit({
      type: LOGIN_SUCCEEDED,
      source: "identity",
      subject: "alice",
      payload: { userId: ALICE_ID, ip: "203.0.113.7" },
      traceId: "trace-1",
    });
    expect(record.type).toBe(LOGIN_SUCCEEDED);
    expect(inserted).toHaveLength(1);
    expect(eventEnvelope.safeParse({ ...record, occurredAt: record.occurredAt }).success).toBe(
      true,
    );
  });
});

describe("事件的 payload", () => {
  const ip = "203.0.113.7";

  it("登录成功、退出、改密成功：键恰好是规格表里列的，其中都有当事人的账号编号 userId", () => {
    const shapes: Array<[ZodType, Record<string, unknown>]> = [
      [loginSucceededPayload, { userId: ALICE_ID, ip }],
      [logoutPayload, { userId: ALICE_ID, ip }],
      [passwordChangedPayload, { userId: ALICE_ID, ip, revokedSessions: 0 }],
    ];
    for (const [schema, payload] of shapes) {
      expect(schema.safeParse(payload).success).toBe(true);
      // 少了 userId、多一个键、userId 不是编号，都过不了（规格 I-40：键只有表里列的）
      expect(schema.safeParse({ ...payload, userId: undefined }).success).toBe(false);
      expect(schema.safeParse({ ...payload, via: "password" }).success).toBe(false);
      expect(schema.safeParse({ ...payload, userId: "alice" }).success).toBe(false);
    }
  });

  it("登录失败的理由只有三种，别的键过不了；也不带 userId（失败时未必有这个人）", () => {
    for (const reason of ["invalid_credentials", "locked_out", "account_disabled"]) {
      expect(loginFailedPayload.safeParse({ ip, reason }).success, reason).toBe(true);
    }
    expect(loginFailedPayload.safeParse({ ip, reason: "typo" }).success).toBe(false);
    expect(loginFailedPayload.safeParse({ ip, reason: "locked_out", password: "x" }).success).toBe(
      false,
    );
    expect(
      loginFailedPayload.safeParse({ ip, reason: "invalid_credentials", userId: ALICE_ID }).success,
    ).toBe(false);
  });
});

describe("失败码", () => {
  it("对外的那张表恰好是规格的九个码，一个不多一个不少（I-04）", () => {
    // 九个码各自由哪条真路由打出来，在 apps/api 的 identity-codes.integration.test.ts 里逐个走了一遍
    expect(Object.values(authErrorCodes).sort()).toEqual([
      "auth_account_disabled",
      "auth_current_password_wrong",
      "auth_forbidden",
      "auth_invalid_credentials",
      "auth_locked_out",
      "auth_password_reused",
      "auth_password_too_weak",
      "auth_required",
      "csrf_origin_mismatch",
    ]);
  });
});

describe("路由声明", () => {
  // 2026-11-28 起，身份模块交出的是登录会话四条（I-01）加管账号、管用户组的十五条（人员规格 G-01）。
  it("登录会话四条，访问级别照规格：登录公开，其余要登录（I-01）", () => {
    const auth = identityContract.routes.filter((declared) =>
      declared.route.path.startsWith("/api/v1/auth/"),
    );
    expect(
      auth.map((declared) => [
        declared.access,
        declared.route.method.toUpperCase(),
        declared.route.path,
      ]),
    ).toEqual([
      ["public", "POST", "/api/v1/auth/login"],
      ["user", "GET", "/api/v1/auth/me"],
      ["user", "POST", "/api/v1/auth/logout"],
      ["user", "POST", "/api/v1/auth/password"],
    ]);
    // 只有登录和改密收请求体，而且请求体是必填的
    const hasBody = auth.map((declared) => "request" in declared.route);
    expect(hasBody).toEqual([true, false, false, true]);
    for (const declared of identityContract.routes) {
      if (!("request" in declared.route) || !("body" in declared.route.request)) continue;
      expect(declared.route.request.body.required, declared.route.path).toBe(true);
    }
  });

  it("管账号的八条加同事名录一条，访问级别照人员规格（G-01）", () => {
    const account = identityContract.routes.filter(
      (declared) =>
        declared.route.path.startsWith("/api/v1/users") || declared.route.path === "/api/v1/people",
    );
    expect(
      account.map((declared) => [
        declared.access,
        declared.route.method.toUpperCase(),
        declared.route.path,
      ]),
    ).toEqual([
      ["admin", "GET", "/api/v1/users"],
      ["admin", "POST", "/api/v1/users"],
      ["admin", "GET", "/api/v1/users/{userId}"],
      ["admin", "PATCH", "/api/v1/users/{userId}"],
      ["admin", "POST", "/api/v1/users/{userId}/password"],
      ["admin", "POST", "/api/v1/users/{userId}/disable"],
      ["admin", "POST", "/api/v1/users/{userId}/enable"],
      ["admin", "DELETE", "/api/v1/users/{userId}"],
      ["user", "GET", "/api/v1/people"],
    ]);
  });

  it("用户组六条，都是 admin（G-01）", () => {
    const group = identityContract.routes.filter((declared) =>
      declared.route.path.startsWith("/api/v1/groups"),
    );
    expect(
      group.map((declared) => [
        declared.access,
        declared.route.method.toUpperCase(),
        declared.route.path,
      ]),
    ).toEqual([
      ["admin", "GET", "/api/v1/groups"],
      ["admin", "POST", "/api/v1/groups"],
      ["admin", "GET", "/api/v1/groups/{groupId}"],
      ["admin", "PATCH", "/api/v1/groups/{groupId}"],
      ["admin", "PUT", "/api/v1/groups/{groupId}/members"],
      ["admin", "DELETE", "/api/v1/groups/{groupId}"],
    ]);
  });

  it("操作名不重复", () => {
    const ids = identityContract.routes.map((declared) => declared.route.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "login",
      "getMe",
      "logout",
      "changePassword",
      "listUsers",
      "createUserAccount",
      "getUserAccount",
      "updateUserAccount",
      "resetUserPassword",
      "disableUserAccount",
      "enableUserAccount",
      "deleteUserAccount",
      "listPeople",
      "listGroups",
      "createUserGroup",
      "getUserGroup",
      "renameUserGroup",
      "replaceGroupMembers",
      "deleteUserGroup",
    ]);
  });
});
