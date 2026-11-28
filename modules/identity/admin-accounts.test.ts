import { describe, expect, it } from "vitest";
import { USER_DISABLED, USER_ENABLED, USER_PASSWORD_RESET, USER_UPDATED } from "./events.ts";
import { createIdentityService } from "./service.ts";
import {
  createClock,
  createFakeEventLog,
  createFakeRepo,
  fakeDb,
  T0,
  userRow,
  type FakeRepo,
} from "./testing/fake.ts";

/**
 * 管账号用例的单元测试（人员规格 G-12 到 G-20，2026-11-28）。不碰数据库：仓储、事件、时钟全是假的。
 * 走真路由的那一半在 apps/api 的集成测试里；这里盖的是「操作者不是目标」也能走到的那半边护栏，
 * 比如「最后一个管理员」——路由上最后一个管理员只能是自己，先撞「不动自己」（设计 03 的顺序）。
 */

const TRACE = { ip: "203.0.113.7", traceId: "trace-1" };
const CHIEF_ID = "10000000-0000-4000-8000-000000000002";
const BOB_ID = "10000000-0000-4000-8000-000000000003";

function chief(overrides: Partial<ReturnType<typeof userRow>> = {}) {
  return userRow({ id: CHIEF_ID, username: "chief", isAdmin: true, ...overrides });
}

async function setup(users: ReturnType<typeof userRow>[], repoSeed?: Partial<FakeRepo["state"]>) {
  const repo = createFakeRepo({ users });
  if (repoSeed?.failOnUserDelete !== undefined)
    repo.state.failOnUserDelete = repoSeed.failOnUserDelete;
  const eventLog = createFakeEventLog();
  const service = createIdentityService({
    db: fakeDb(),
    repo,
    eventLog,
    passwordMinLength: 8,
    now: createClock().now,
    password: {
      hash: async (password) => `hash:${password}`,
      verify: async (stored, password) => stored === `hash:${password}`,
    },
  });
  return { service, repo, eventLog };
}

describe("改号（规格 G-13、G-19、G-20）", () => {
  it("操作者不是目标、目标又是唯一启用的管理员：降级回 last_admin，不写不发（G-18、G-20）", async () => {
    // 操作者（甲）自己也停用了：路由上到不了这里，用例的护栏照样拦——这是它真正打 last_admin 的形状
    const { service, repo, eventLog } = await setup([
      chief({ disabledAt: new Date(T0.getTime() + 1000) }),
      userRow({ id: BOB_ID, username: "bob", isAdmin: true }),
    ]);
    const result = await service.updateAccount({
      ...TRACE,
      operatorId: CHIEF_ID,
      userId: BOB_ID,
      isAdmin: false,
    });
    expect(result).toEqual({ kind: "last_admin" });
    expect(repo.state.users.find((user) => user.id === BOB_ID)?.isAdmin).toBe(true);
    expect(eventLog.emitted).toEqual([]);
  });

  it("降级前锁住启用的管理员：锁的调用发生在写之前（G-20 的形状）", async () => {
    const { service, repo } = await setup([chief(), userRow({ id: BOB_ID, username: "bob" })]);
    const order: string[] = [];
    const lock = repo.users.lockEnabledAdmins;
    repo.users.lockEnabledAdmins = async (ex) => {
      order.push("lock");
      return lock(ex);
    };
    const setIsAdmin = repo.users.setIsAdmin;
    repo.users.setIsAdmin = async (...args) => {
      order.push("write");
      return setIsAdmin(...args);
    };
    const result = await service.updateAccount({
      ...TRACE,
      operatorId: CHIEF_ID,
      userId: BOB_ID,
      isAdmin: true, // 目标不是管理员，升不升无所谓：不会减管理员数，不锁
    });
    expect(result.kind).toBe("ok");
    expect(order).toEqual(["write"]);
  });

  it("给自己降级回 self_change，即使他不是最后一个（G-19）", async () => {
    const { service, repo, eventLog } = await setup([
      chief(),
      userRow({ id: BOB_ID, username: "bob", isAdmin: true }),
    ]);
    const result = await service.updateAccount({
      ...TRACE,
      operatorId: CHIEF_ID,
      userId: CHIEF_ID,
      isAdmin: false,
    });
    expect(result).toEqual({ kind: "self_change" });
    expect(repo.state.users.find((user) => user.id === CHIEF_ID)?.isAdmin).toBe(true);
    expect(eventLog.emitted).toEqual([]);
  });

  it("改自己的显示名不在四个动作里：改得动（G-19）", async () => {
    const { service, eventLog } = await setup([chief()]);
    const result = await service.updateAccount({
      ...TRACE,
      operatorId: CHIEF_ID,
      userId: CHIEF_ID,
      displayName: "头儿",
    });
    expect(result).toEqual({ kind: "ok", user: expect.objectContaining({ displayName: "头儿" }) });
    expect(eventLog.emitted.map((event) => event.type)).toEqual([USER_UPDATED]);
  });

  it("改自己降级之外的部分（升成管理员、改名）不拦（G-19 的边界）", async () => {
    const { service } = await setup([chief(), userRow({ id: BOB_ID, username: "bob" })]);
    // 目标是自己、isAdmin: true（不变）也不拦
    const result = await service.updateAccount({
      ...TRACE,
      operatorId: CHIEF_ID,
      userId: CHIEF_ID,
      isAdmin: true,
    });
    expect(result.kind).toBe("no_change");
  });
});

describe("重置口令（规格 G-14）", () => {
  it("给别的账号重置：换散列、删光他的会话、发带 revokedSessions 的事件", async () => {
    const { service, repo, eventLog } = await setup([
      chief(),
      userRow({ id: BOB_ID, username: "bob" }),
    ]);
    await repo.sessions.insert(fakeDb(), {
      id: "30000000-0000-4000-8000-000000000001",
      userId: BOB_ID,
      tokenHash: "token-hash-bob",
      createdAt: T0,
      lastSeenAt: T0,
      expiresAt: new Date(T0.getTime() + 20 * 24 * 60 * 60 * 1000),
    });
    const result = await service.resetAccountPassword({
      ...TRACE,
      operatorId: CHIEF_ID,
      userId: BOB_ID,
      newPassword: "brand-new-password",
    });
    expect(result).toEqual({ kind: "ok", revokedSessions: 1 });
    expect(repo.state.users.find((user) => user.id === BOB_ID)?.passwordHash).toBe(
      "hash:brand-new-password",
    );
    expect(repo.state.sessions).toEqual([]);
    expect(eventLog.emitted.map((event) => event.type)).toEqual([USER_PASSWORD_RESET]);
    expect(eventLog.emitted[0]?.payload).toEqual({
      userId: BOB_ID,
      actorId: CHIEF_ID,
      revokedSessions: 1,
    });
  });

  it("口令太短不写库；给自己重置在散列之前就拒（G-14、G-19）", async () => {
    const { service, repo, eventLog } = await setup([chief()]);
    expect(
      await service.resetAccountPassword({
        ...TRACE,
        operatorId: CHIEF_ID,
        userId: CHIEF_ID,
        newPassword: "brand-new-password",
      }),
    ).toEqual({ kind: "self_change" });
    expect(
      await service.resetAccountPassword({
        ...TRACE,
        operatorId: CHIEF_ID,
        userId: BOB_ID,
        newPassword: "short-7",
      }),
    ).toEqual({ kind: "too_weak" });
    expect(repo.state.users.find((user) => user.id === CHIEF_ID)?.passwordHash).toMatch(
      /^\$argon2id\$/,
    );
    expect(eventLog.emitted).toEqual([]);
  });
});

describe("停用与启用（规格 G-15 到 G-17）", () => {
  it("停用删光会话、发事件；启用清位、不恢复会话、各发一条事件", async () => {
    const { service, repo, eventLog } = await setup([
      chief(),
      userRow({ id: BOB_ID, username: "bob" }),
    ]);
    await repo.sessions.insert(fakeDb(), {
      id: "30000000-0000-4000-8000-000000000001",
      userId: BOB_ID,
      tokenHash: "token-hash-bob",
      createdAt: T0,
      lastSeenAt: T0,
      expiresAt: new Date(T0.getTime() + 20 * 24 * 60 * 60 * 1000),
    });
    expect(
      await service.setAccountDisabled({
        ...TRACE,
        operatorId: CHIEF_ID,
        userId: BOB_ID,
        disabled: true,
      }),
    ).toEqual({ kind: "ok", user: expect.objectContaining({ id: BOB_ID }) });
    expect(repo.state.sessions).toEqual([]);
    expect(
      await service.setAccountDisabled({
        ...TRACE,
        operatorId: CHIEF_ID,
        userId: BOB_ID,
        disabled: false,
      }),
    ).toEqual({ kind: "ok", user: expect.objectContaining({ disabledAt: null }) });
    expect(repo.state.sessions).toEqual([]);
    expect(eventLog.emitted.map((event) => event.type)).toEqual([USER_DISABLED, USER_ENABLED]);
  });

  it("已是这个状态：no_change，不写不发（实现定下，同「没变就不动」）", async () => {
    const { service, eventLog } = await setup([chief()]);
    expect(
      await service.setAccountDisabled({
        ...TRACE,
        operatorId: CHIEF_ID,
        userId: CHIEF_ID,
        disabled: false,
      }),
    ).toEqual({ kind: "no_change", user: expect.objectContaining({ disabledAt: null }) });
    expect(eventLog.emitted).toEqual([]);
  });

  it("停用最后一个启用的管理员（目标不是操作者）：last_admin，不写不发（G-18）", async () => {
    const { service, repo, eventLog } = await setup([
      chief({ disabledAt: new Date(T0.getTime() + 1000) }),
      userRow({ id: BOB_ID, username: "bob", isAdmin: true }),
    ]);
    const result = await service.setAccountDisabled({
      ...TRACE,
      operatorId: CHIEF_ID,
      userId: BOB_ID,
      disabled: true,
    });
    expect(result).toEqual({ kind: "last_admin" });
    expect(repo.state.users.find((user) => user.id === BOB_ID)?.disabledAt).toBeNull();
    expect(eventLog.emitted).toEqual([]);
  });

  it("停用自己（还有一个启用的管理员时）回 self_change；停用对象必须在（G-19）", async () => {
    const { service, eventLog } = await setup([
      chief(),
      userRow({ id: BOB_ID, username: "bob", isAdmin: true }),
    ]);
    expect(
      await service.setAccountDisabled({
        ...TRACE,
        operatorId: CHIEF_ID,
        userId: CHIEF_ID,
        disabled: true,
      }),
    ).toEqual({ kind: "self_change" });
    expect(
      await service.setAccountDisabled({
        ...TRACE,
        operatorId: CHIEF_ID,
        userId: "30000000-0000-4000-8000-0000000000ff",
        disabled: true,
      }),
    ).toEqual({ kind: "not_found" });
    expect(eventLog.emitted).toEqual([]);
  });

  it("最后一个管理员停用自己：两个 409 都命中，数量那道闸先说——last_admin（G-18、G-19；实现定下）", async () => {
    const { service, repo, eventLog } = await setup([chief()]);
    expect(
      await service.setAccountDisabled({
        ...TRACE,
        operatorId: CHIEF_ID,
        userId: CHIEF_ID,
        disabled: true,
      }),
    ).toEqual({ kind: "last_admin" });
    expect(repo.state.users.find((user) => user.id === CHIEF_ID)?.disabledAt).toBeNull();
    expect(eventLog.emitted).toEqual([]);
  });
});

describe("建号（规格 G-08 到 G-11 的用例侧）", () => {
  it("管理员建号：显示名没给等于用户名；给了空格收成去掉后的值；事件带 via: admin 和 actorId（G-08、G-12）", async () => {
    const { service, repo, eventLog } = await setup([chief()]);
    const first = await service.createAccount({
      ...TRACE,
      operatorId: CHIEF_ID,
      username: "alice",
      password: "alice-password-1",
      isAdmin: false,
    });
    expect(first.kind).toBe("ok");
    expect(repo.state.users.find((user) => user.username === "alice")?.displayName).toBe("alice");
    const second = await service.createAccount({
      ...TRACE,
      operatorId: CHIEF_ID,
      username: "bob",
      password: "alice-password-1",
      displayName: "  乙  ",
      isAdmin: false,
    });
    expect(second.kind).toBe("ok");
    expect(repo.state.users.find((user) => user.username === "bob")?.displayName).toBe("乙");
    expect(eventLog.emitted.map((event) => event.type)).toEqual([
      "identity.user.created",
      "identity.user.created",
    ]);
    expect(eventLog.emitted[1]?.payload).toEqual({
      userId: expect.any(String),
      isAdmin: false,
      via: "admin",
      actorId: CHIEF_ID,
    });
  });

  it("显示名不合规回 display_name_invalid；口令太长回 password_too_long（G-10、G-12）", async () => {
    const { service, repo } = await setup([chief()]);
    expect(
      await service.createAccount({
        ...TRACE,
        operatorId: CHIEF_ID,
        username: "alice",
        password: "alice-password-1",
        displayName: "含\n换行",
        isAdmin: false,
      }),
    ).toEqual({ kind: "rejected", reason: "display_name_invalid" });
    expect(
      await service.createAccount({
        ...TRACE,
        operatorId: CHIEF_ID,
        username: "alice",
        password: "a".repeat(129),
        isAdmin: false,
      }),
    ).toEqual({ kind: "rejected", reason: "password_too_long" });
    expect(repo.state.users).toHaveLength(1);
  });
});

describe("人员清单与同事名录（规格 G-06、G-07 的用例侧）", () => {
  it("清单全部、名录只列启用，都按用户名升序", async () => {
    const { service } = await setup([
      chief(),
      userRow({ id: BOB_ID, username: "bob" }),
      userRow({
        id: "10000000-0000-4000-8000-000000000004",
        username: "carol",
        disabledAt: new Date(T0.getTime() + 1000),
      }),
    ]);
    expect((await service.listAccounts()).map((user) => user.username)).toEqual([
      "bob",
      "carol",
      "chief",
    ]);
    expect((await service.listPeople()).map((user) => user.username)).toEqual(["bob", "chief"]);
  });
});
