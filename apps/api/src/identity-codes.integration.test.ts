import type { DatabaseHandle } from "@nexus/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH,
  boot,
  call,
  clearIdentity,
  createTestDatabase,
  loginAs,
  seedUser,
  userRows,
  type CallOptions,
  type Reply,
  type TestApp,
} from "./testing/kit.ts";

/**
 * 失败回应的内容。身份模块回失败时只用规格表里那九个码（I-04），这里让每个码都从一条真路由里打出来；
 * 另外验任何回应的正文里都不出现库里的散列串（I-45 的集成测试那一半，扫接口文档那一半在 identity-contract.test.ts）。
 */

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
const NEXT = "brand-new-password";

/** 规格的错误码表，去掉 `invalid_request`、`not_found`、`internal_error` 这三个不是身份模块的。 */
const NINE_CODES = [
  "auth_required",
  "auth_invalid_credentials",
  "auth_locked_out",
  "auth_forbidden",
  "auth_account_disabled",
  "csrf_origin_mismatch",
  "auth_current_password_wrong",
  "auth_password_too_weak",
  "auth_password_reused",
];

type Scenario = readonly [code: string, status: number, run: () => Promise<Reply>];

/** 九个场景。各用各的用户名：锁定的状态存在库里，先后用同一个用户名会被前一个场景连累。 */
async function scenarios(app: TestApp["app"]): Promise<Scenario[]> {
  await seedUser(database.db, { username: "alice", password: PASSWORD });
  await seedUser(database.db, { username: "chief", password: PASSWORD, isAdmin: true });
  await seedUser(database.db, { username: "officer", password: PASSWORD, disabledAt: new Date() });
  await seedUser(database.db, { username: "locky", password: PASSWORD });
  const alice = await loginAs(app, "alice", PASSWORD);
  const chief = await loginAs(app, "chief", PASSWORD);
  const login = (username: string, password: string, origin?: string) =>
    call(app, AUTH.login, {
      method: "POST",
      body: { username, password },
      ...(origin === undefined ? {} : { origin }),
    });
  const change = (cookie: string, currentPassword: string, newPassword: string) =>
    call(app, AUTH.password, { method: "POST", cookie, body: { currentPassword, newPassword } });
  return [
    ["auth_required", 401, () => call(app, AUTH.me)],
    ["auth_invalid_credentials", 401, () => login("alice", "wrong-password")],
    [
      "auth_locked_out",
      429,
      async () => {
        for (let i = 0; i < 5; i++) await login("locky", "wrong-password");
        return login("locky", PASSWORD);
      },
    ],
    ["auth_forbidden", 403, () => call(app, AUTH.doc, { cookie: alice.cookie })],
    ["auth_account_disabled", 403, () => login("officer", PASSWORD)],
    ["csrf_origin_mismatch", 403, () => login("alice", PASSWORD, "https://evil.example")],
    ["auth_current_password_wrong", 400, () => change(alice.cookie, "not-the-old-one", NEXT)],
    ["auth_password_too_weak", 400, () => change(alice.cookie, PASSWORD, "short-7")],
    ["auth_password_reused", 400, () => change(chief.cookie, PASSWORD, PASSWORD)],
  ];
}

describe("九个失败码（规格 I-04）", () => {
  it("每个码都由一条真路由打出来，状态码和规格的表一致；表里恰好是这九个", async () => {
    const api = await boot({ db: database.db });
    const table = await scenarios(api.app);
    // 场景表本身就是从 NINE_CODES 一一对应着写的：不许少写一个场景，也不许多出一个
    expect(table.map(([code]) => code)).toEqual(NINE_CODES);
    for (const [code, status, run] of table) {
      const reply = await run();
      expect(reply.status, code).toBe(status);
      expect(reply.error?.code, code).toBe(code);
    }
  });

  it("每个失败回应都是同一个形状：code、message、requestId；只有 429 多一个 details", async () => {
    const api = await boot({ db: database.db });
    for (const [code, , run] of await scenarios(api.app)) {
      const reply = await run();
      const keys = Object.keys(reply.error ?? {}).sort();
      expect(keys, code).toEqual(
        code === "auth_locked_out"
          ? ["code", "details", "message", "requestId"]
          : ["code", "message", "requestId"],
      );
      expect(reply.error?.requestId, code).toBe(reply.requestId);
      expect(reply.error?.requestId, code).toMatch(/^[0-9a-f-]{36}$/);
      expect(reply.error?.message.length, code).toBeGreaterThan(0);
    }
  });
});

describe("回应的正文里不出库里的散列串（规格 I-45）", () => {
  it("登录、我是谁、改密、退出，成功的和失败的回应都算上：改密前后的散列串、盐、摘要都不出现", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const before = await storedHash();
    expect(before).toMatch(/^\$argon2id\$/);

    const bodies: string[] = [];
    const hit = async (path: string, options: CallOptions = {}): Promise<Reply> => {
      const reply = await call(api.app, path, options);
      bodies.push(JSON.stringify(reply.body));
      return reply;
    };
    const signed = await hit(AUTH.login, {
      method: "POST",
      body: { username: "alice", password: PASSWORD },
    });
    expect(signed.status).toBe(200);
    const cookie = signed.setCookies[0]?.split(";")[0] ?? "";
    expect((await hit(AUTH.me, { cookie })).status).toBe(200);
    expect(
      (await hit(AUTH.login, { method: "POST", body: { username: "alice", password: "nope" } }))
        .status,
    ).toBe(401);
    const changed = await hit(AUTH.password, {
      method: "POST",
      cookie,
      body: { currentPassword: PASSWORD, newPassword: NEXT },
    });
    expect(changed.status).toBe(200);
    const fresh = changed.setCookies[0]?.split(";")[0] ?? "";
    expect(
      (
        await hit(AUTH.password, {
          method: "POST",
          cookie: fresh,
          body: { currentPassword: NEXT, newPassword: "short-7" },
        })
      ).status,
    ).toBe(400);
    expect((await hit(AUTH.me, { cookie })).status).toBe(401);
    expect((await hit(AUTH.logout, { method: "POST", cookie: fresh })).status).toBe(200);
    expect((await hit(AUTH.me, { cookie: fresh })).status).toBe(401);
    expect((await hit("/api/auth/login", { method: "POST", body: {} })).status).toBe(404);
    expect(bodies.length).toBe(9);
    // 对照组：用户名在正文里查得到，说明收上来的确实是正文
    expect(bodies.filter((body) => body.includes("alice")).length).toBeGreaterThan(0);

    const after = await storedHash();
    expect(after).not.toBe(before);
    // 散列串本身，加上它的盐和摘要两段（$argon2id$v=19$m=…,t=…,p=…$盐$摘要）
    for (const hash of [before, after]) {
      for (const secret of [hash, ...hash.split("$").slice(4)]) {
        expect(secret.length, secret.slice(0, 12)).toBeGreaterThan(20);
        expect(
          bodies.filter((body) => body.includes(secret)),
          secret.slice(0, 12),
        ).toEqual([]);
      }
    }
  });
});

/** 库里那一个账号的口令散列串。 */
async function storedHash(): Promise<string> {
  const hash = (await userRows(database.db))[0]?.password_hash;
  if (typeof hash !== "string") throw new Error("库里没有口令散列");
  return hash;
}
