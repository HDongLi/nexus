import type { DatabaseHandle } from "@nexus/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH,
  boot,
  call,
  clearIdentity,
  createTestDatabase,
  failureRows,
  identityEvents,
  loginAs,
  PAGE_ORIGIN,
  seedUser,
  sessionRows,
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
const OWN = PAGE_ORIGIN;
const FOREIGN = "https://evil.example";

describe("来源校验：写请求的跨站防护（规格 I-35 到 I-37）", () => {
  it("和请求自己的地址一样的 Origin：登录和改密都放行", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const login = await call(api.app, AUTH.login, {
      method: "POST",
      origin: OWN,
      body: { username: "alice", password: PASSWORD },
    });
    expect(login.status).toBe(200);
    const cookie = login.setCookies[0]?.split(";")[0] ?? "";
    const change = await call(api.app, AUTH.password, {
      method: "POST",
      origin: OWN,
      cookie,
      body: { currentPassword: PASSWORD, newPassword: "brand-new-password" },
    });
    expect(change.status).toBe(200);
  });

  it("外域的 Origin：登录（public）和改密（user）都回 403 csrf_origin_mismatch，不分访问级别（I-35）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const login = await call(api.app, AUTH.login, {
      method: "POST",
      origin: FOREIGN,
      body: { username: "alice", password: PASSWORD },
    });
    expect(login.status).toBe(403);
    expect(login.error).toMatchObject({ code: "csrf_origin_mismatch", requestId: login.requestId });

    const { cookie } = await loginAs(api.app, "alice", PASSWORD);
    for (const path of [AUTH.password, AUTH.logout]) {
      const reply = await call(api.app, path, {
        method: "POST",
        origin: FOREIGN,
        cookie,
        body:
          path === AUTH.password
            ? { currentPassword: PASSWORD, newPassword: "brand-new-password" }
            : undefined,
      });
      expect(reply.status, path).toBe(403);
      expect(reply.error?.code, path).toBe("csrf_origin_mismatch");
    }
  });

  it("Origin: null 拒绝；不带 Origin 放行（I-36）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const nullOrigin = await call(api.app, AUTH.login, {
      method: "POST",
      origin: "null",
      body: { username: "alice", password: PASSWORD },
    });
    expect(nullOrigin.status).toBe(403);
    expect(nullOrigin.error?.code).toBe("csrf_origin_mismatch");

    const absent = await call(api.app, AUTH.login, {
      method: "POST",
      body: { username: "alice", password: PASSWORD },
    });
    expect(absent.status).toBe(200);
  });

  it("同一个主机、端口不同：拒绝；协议不同：拒绝；大小写不同：放行（I-37）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const attempts: [string, number][] = [
      ["http://127.0.0.1:4260", 403],
      ["https://127.0.0.1:4261", 403],
      ["http://localhost:4261", 403],
      ["HTTP://127.0.0.1:4261", 200],
    ];
    for (const [origin, status] of attempts) {
      const reply = await call(api.app, AUTH.login, {
        method: "POST",
        origin,
        body: { username: "alice", password: PASSWORD },
      });
      expect(reply.status, origin).toBe(status);
    }
  });

  it("配了 PUBLIC_ORIGIN 就按它比，不再看请求自己的地址", async () => {
    const api = await boot({ db: database.db, publicOrigin: "https://nexus.example.com" });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const body = { username: "alice", password: PASSWORD };
    const configured = await call(api.app, AUTH.login, {
      method: "POST",
      origin: "https://nexus.example.com",
      body,
    });
    expect(configured.status).toBe(200);
    const ownAddress = await call(api.app, AUTH.login, { method: "POST", origin: OWN, body });
    expect(ownAddress.status).toBe(403);
    const otherPort = await call(api.app, AUTH.login, {
      method: "POST",
      origin: "https://nexus.example.com:8443",
      body,
    });
    expect(otherPort.status).toBe(403);
  });

  it("读方法不查来源：外域 Origin 的 GET 照常；所以改状态的接口不得用读方法（I-35）", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    const { cookie } = await loginAs(api.app, "alice", PASSWORD);
    const me = await call(api.app, AUTH.me, { origin: FOREIGN, cookie });
    expect(me.status).toBe(200);
    const health = await call(api.app, AUTH.health, { origin: FOREIGN });
    expect(health.status).toBe(200);
  });

  it("被来源校验拒绝的登录排在最前面：不验口令、不记失败、不发事件、不种 cookie", async () => {
    const api = await boot({ db: database.db });
    await seedUser(database.db, { username: "alice", password: PASSWORD });
    for (let i = 0; i < 6; i++) {
      const reply = await call(api.app, AUTH.login, {
        method: "POST",
        origin: FOREIGN,
        body: { username: "alice", password: "wrong-password" },
      });
      expect(reply.setCookies).toEqual([]);
    }
    expect(await failureRows(database.db)).toEqual([]);
    expect(await identityEvents(database.db)).toEqual([]);
    expect(await sessionRows(database.db)).toEqual([]);
  });

  it("被拒时日志里记下两边的值，带着请求号，方便对出部署哪里配错了", async () => {
    const api = await boot({ db: database.db });
    const reply = await call(api.app, AUTH.login, {
      method: "POST",
      origin: FOREIGN,
      body: { username: "alice", password: PASSWORD },
      requestId: "trace-csrf",
    });
    expect(reply.status).toBe(403);
    const logged = api.log.entries().find((entry) => entry.msg === "来源校验拒绝");
    expect(logged).toMatchObject({ requestId: "trace-csrf", origin: FOREIGN, expected: OWN });
  });
});
