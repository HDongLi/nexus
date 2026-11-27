import type { DatabaseHandle } from "@nexus/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH,
  boot,
  call,
  clearIdentity,
  createTestDatabase,
  DAY_MS,
  loginAs,
  seedUser,
  type TestApp,
} from "./testing/kit.ts";

let database: DatabaseHandle;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await clearIdentity(database.db);
});

const PASSWORD = "alice-password-1";

describe("访问闸：三个级别各自的失败（规格 I-44）", () => {
  it("需要登录的接口不再回 501：没带会话 401 auth_required，带会话 200（I-05）", async () => {
    const api = await boot({ db: database.db });
    const anonymous = await call(api.app, AUTH.info);
    expect(anonymous.status).toBe(401);
    expect(anonymous.error).toMatchObject({
      code: "auth_required",
      requestId: anonymous.requestId,
    });

    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const { cookie } = await loginAs(api.app, "alice", PASSWORD);
    const signed = await call(api.app, AUTH.info, { cookie });
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({ version: "9.9.9", boot: { version: "9.9.9" } });
    // 这个接口的契约里也不再有 501（上一张卡留的断言由此改写）
    expect(JSON.stringify(signed.body)).not.toContain("auth_not_wired");
  });

  it("user 级路由：没有 cookie、错的 cookie、过期的、停用的，都是 401 auth_required", async () => {
    const api = await boot({ db: database.db });
    const user = await seedUser(database.db, { username: "alice", password: PASSWORD });
    const expiredApp = await boot({ db: database.db });
    const expiring = await loginAs(expiredApp.app, "alice", PASSWORD);
    expiredApp.clock.tick(30 * DAY_MS);

    const disabledApp = await boot({ db: database.db });
    const disowned = await loginAs(disabledApp.app, "alice", PASSWORD);
    await disabledApp.identity.service.setDisabled(user.id, true);
    await disabledApp.identity.service.setDisabled(user.id, false);

    const cases: [string, TestApp, string | undefined][] = [
      ["没有 cookie", api, undefined],
      ["伪造的 cookie", api, "nexus_session=forged-token"],
      ["别人注销之后留下的 cookie", api, await deadCookie(api)],
      ["过了有效期", expiredApp, expiring.cookie],
      ["账号停用过（重新启用了也不算）", disabledApp, disowned.cookie],
    ];
    for (const [label, target, cookie] of cases) {
      for (const [path, method] of [
        [AUTH.me, "GET"],
        [AUTH.logout, "POST"],
        [AUTH.password, "POST"],
        [AUTH.info, "GET"],
        [AUTH.doc, "GET"],
      ] as const) {
        const reply = await call(target.app, path, {
          method,
          ...(cookie === undefined ? {} : { cookie }),
          ...(method === "POST" && path === AUTH.password
            ? { body: { currentPassword: PASSWORD, newPassword: "another-pass-1" } }
            : {}),
        });
        expect(reply.status, `${label} → ${path}`).toBe(401);
        expect(reply.error?.code, `${label} → ${path}`).toBe("auth_required");
        expect(reply.error?.requestId, `${label} → ${path}`).toBe(reply.requestId);
      }
    }
  });

  it("admin 级路由：没有有效会话 401；有会话但不是管理员 403 auth_forbidden（I-44、I-27）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "plain", password: PASSWORD });
    await seedUser(database.db, { username: "chief", password: PASSWORD, isAdmin: true });
    expect((await call(api.app, AUTH.doc)).status).toBe(401);
    const plain = await loginAs(api.app, "plain", PASSWORD);
    const denied = await call(api.app, AUTH.doc, { cookie: plain.cookie });
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe("auth_forbidden");
    const chief = await loginAs(api.app, "chief", PASSWORD);
    const allowed = await call(api.app, AUTH.doc, { cookie: chief.cookie });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({ openapi: "3.1.0" });
  });

  it("isAdmin 为真，当且仅当 GET /api/v1/doc 不回 403 auth_forbidden（I-27）", async () => {
    const api = await boot({ db: database.db });
    for (const [username, isAdmin] of [
      ["yes-admin", true],
      ["no-admin", false],
    ] as const) {
      await seedUser(database.db, { username, password: PASSWORD, isAdmin });
      const { cookie } = await loginAs(api.app, username, PASSWORD);
      const me = (await call(api.app, AUTH.me, { cookie })).body as { user: { isAdmin: boolean } };
      const doc = await call(api.app, AUTH.doc, { cookie });
      expect(doc.status === 403 && doc.error?.code === "auth_forbidden", username).toBe(!isAdmin);
      expect(me.user.isAdmin, username).toBe(isAdmin);
    }
  });

  it("public 路由不因身份被拒：带着垃圾 cookie、带着停用账号的 cookie，健康探测照样 200", async () => {
    const api = await boot({ db: database.db });
    const user = await seedUser(database.db, { username: "goneoff", password: PASSWORD });
    const { cookie } = await loginAs(api.app, "goneoff", PASSWORD);
    await api.identity.service.setDisabled(user.id, true);
    expect((await call(api.app, AUTH.health, { cookie: "nexus_session=garbage" })).status).toBe(
      200,
    );
    expect((await call(api.app, AUTH.health, { cookie })).status).toBe(200);
    expect(
      (
        await call(api.app, AUTH.login, {
          method: "POST",
          body: { username: "whoever", password: "x" },
          cookie: "nexus_session=garbage",
        })
      ).status,
    ).toBe(401);
  });

  it("没声明的路由一律 404 not_found，带着有效会话也一样", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const { cookie } = await loginAs(api.app, "alice", PASSWORD);
    for (const path of ["/api/v1/nope", "/api/v1/auth/nope", "/api/v1/system/info/extra"]) {
      const reply = await call(api.app, path, { cookie });
      expect(reply.status, path).toBe(404);
      expect(reply.error?.code, path).toBe("not_found");
    }
    expect((await call(api.app, AUTH.me, { method: "POST", cookie })).status).toBe(404);
  });
});

/** 登录再退出，回一枚已经作废的 cookie。 */
async function deadCookie(api: TestApp): Promise<string> {
  const { cookie } = await loginAs(api.app, "alice", PASSWORD);
  await call(api.app, AUTH.logout, { method: "POST", cookie });
  return cookie;
}
