import type { Db, Tx } from "@nexus/db";
import { describe, expect, it } from "vitest";
import { USERNAME_PATTERN } from "./accounts.ts";
import { PASSWORD_CHANGED, USER_CREATED } from "./events.ts";
import { hashToken } from "./tokens.ts";
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

const CURRENT = "current-password";
const WRONG = "wrong-password";
const NEXT = "brand-new-password";
const ALICE = userRow({ passwordHash: `hash:${CURRENT}` });
const BOB = userRow({
  id: "10000000-0000-4000-8000-000000000003",
  username: "bob",
  displayName: "bob",
  passwordHash: `hash:${CURRENT}`,
});
const TRACE = { ip: "203.0.113.7", traceId: "trace-1" };
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 搭一个用例环境。alice 手里永远有一枚令牌 token-a；
 * withOthers 再给她开 token-b、token-c，并给 bob 开一枚，用来验「只动这个人的其它会话」。
 */
async function setup(options: { users?: (typeof ALICE)[]; withOthers?: boolean; db?: Db } = {}) {
  const repo: FakeRepo = createFakeRepo({ users: options.users ?? [ALICE] });
  const eventLog = createFakeEventLog();
  const clock = createClock();
  const hashes: string[] = [];
  const service = createIdentityService({
    db: options.db ?? fakeDb(),
    repo,
    eventLog,
    passwordMinLength: 8,
    now: clock.now,
    password: {
      hash: async (password) => {
        hashes.push(password);
        return `hash:${password}`;
      },
      // 约定：存的是 hash:<口令> 的形式，口令才算对
      verify: async (stored, password) => stored === `hash:${password}`,
    },
  });
  const open = async (id: string, userId: string, token: string) =>
    repo.sessions.insert(fakeDb(), {
      id,
      userId,
      tokenHash: await hashToken(token),
      createdAt: T0,
      lastSeenAt: T0,
      expiresAt: new Date(T0.getTime() + 20 * DAY_MS),
    });
  await open("20000000-0000-4000-8000-000000000001", ALICE.id, "token-a");
  if (options.withOthers) {
    await open("20000000-0000-4000-8000-000000000002", ALICE.id, "token-b");
    await open("20000000-0000-4000-8000-000000000003", ALICE.id, "token-c");
    await open("20000000-0000-4000-8000-000000000009", BOB.id, "token-bob");
  }
  const change = (currentPassword: string, newPassword: string, token = "token-a") =>
    service.changePassword({ ...TRACE, token, currentPassword, newPassword });
  return { service, repo, eventLog, hashes, change, open };
}

describe("本人改密", () => {
  it("新口令太短：不验旧口令，也不记失败（I-32）", async () => {
    const { change, repo } = await setup();
    expect(await change(WRONG, "short-7")).toEqual({ kind: "too_weak" });
    expect(repo.state.failures.size).toBe(0);
    // 旧口令是真的不对：如果验过，就会记下一次失败
    expect(repo.state.failures.get("alice")).toBeUndefined();
  });

  it("旧口令不对：回 current_password_wrong，并像登录失败一样记一次失败；不发事件（I-31）", async () => {
    const { change, repo, eventLog } = await setup();
    expect(await change(WRONG, NEXT)).toEqual({ kind: "current_password_wrong" });
    expect(repo.state.failures.get("alice")?.failureCount).toBe(1);
    expect(eventLog.emitted).toEqual([]);
  });

  it("用户名处于锁定时，改密回 locked（I-31）", async () => {
    const { change, repo } = await setup();
    for (let i = 0; i < 5; i++) await change(WRONG, NEXT);
    // 旧口令这次是对的，照样进不来
    expect(await change(CURRENT, NEXT)).toEqual({ kind: "locked", retryAfterSeconds: 900 });
    expect(repo.state.failures.get("alice")?.failureCount).toBe(5);
  });

  it("新口令和旧口令相同：回 reused（I-33）", async () => {
    const { change, repo } = await setup();
    expect(await change(CURRENT, CURRENT)).toEqual({ kind: "reused" });
    expect(repo.state.failures.size).toBe(0);
  });

  it("成功：换散列，吊销其它会话，当前会话换令牌，事件带上被吊销的数量（I-30）", async () => {
    const { service, repo, eventLog, hashes, change } = await setup({ withOthers: true });
    const result = await change(CURRENT, NEXT);
    if (result.kind !== "ok") throw new Error("应当改密成功");
    expect(result.revokedSessions).toBe(2);
    expect(hashes).toEqual([NEXT]);
    expect(repo.state.users[0]).toMatchObject({
      passwordHash: `hash:${NEXT}`,
      passwordChangedAt: T0,
    });
    // alice 只剩当前这一条会话，bob 的原样
    expect(repo.state.sessions.map((s) => s.userId)).toEqual([ALICE.id, BOB.id]);
    expect(await service.authenticate("token-a")).toBeUndefined();
    expect(await service.authenticate("token-b")).toBeUndefined();
    expect(await service.authenticate(result.token)).toMatchObject({ user: { username: "alice" } });
    expect(eventLog.emitted).toEqual([
      {
        type: PASSWORD_CHANGED,
        source: "identity",
        subject: "alice",
        payload: { userId: ALICE.id, ip: "203.0.113.7", revokedSessions: 2 },
        occurredAt: T0.toISOString(),
        traceId: "trace-1",
      },
    ]);
  });

  it("改密成功不清失败记录（I-31）", async () => {
    const { change, repo } = await setup();
    await change(WRONG, NEXT);
    await change(CURRENT, NEXT);
    expect(repo.state.failures.get("alice")?.failureCount).toBe(1);
  });

  it("拿来改密的会话没了，或者账号已停用：回 no_session，什么都不改", async () => {
    const eve = {
      ...ALICE,
      id: "10000000-0000-4000-8000-000000000004",
      username: "eve",
      disabledAt: T0,
    };
    const { change, open, repo } = await setup({ users: [ALICE, eve] });
    expect(await change(CURRENT, NEXT, "no-such-token")).toEqual({ kind: "no_session" });
    await open("20000000-0000-4000-8000-000000000010", eve.id, "token-eve");
    expect(await change(CURRENT, NEXT, "token-eve")).toEqual({ kind: "no_session" });
    expect(repo.state.users.map((u) => u.passwordHash)).toEqual([
      `hash:${CURRENT}`,
      `hash:${CURRENT}`,
    ]);
  });
});

describe("建账号", () => {
  it("用户名的规则，表驱动（I-34）", () => {
    const valid = ["a", "Alice_01", "x-y_z", "9", "-".repeat(64), "a".repeat(64)];
    const invalid = ["", "a".repeat(65), "有", "a.b", "a b", "a@b", "a/b", "a+b"];
    for (const name of valid) expect(USERNAME_PATTERN.test(name), name).toBe(true);
    for (const name of invalid) expect(USERNAME_PATTERN.test(name), name).toBe(false);
  });

  it("建出来的账号未停用、显示名等于用户名、发一条 user.created（I-46）", async () => {
    const { service, repo, eventLog, hashes } = await setup({ users: [] });
    const result = await service.createUser({
      username: "alice",
      password: "long-enough-pw",
      isAdmin: true,
    });
    expect(result).toMatchObject({
      kind: "ok",
      user: { id: expect.any(String), username: "alice", displayName: "alice", isAdmin: true },
    });
    expect(repo.state.users[0]).toMatchObject({
      disabledAt: null,
      displayName: "alice",
      isAdmin: true,
      passwordHash: "hash:long-enough-pw",
      createdAt: T0,
    });
    expect(hashes).toEqual(["long-enough-pw"]);
    expect(eventLog.emitted).toEqual([
      {
        type: USER_CREATED,
        source: "identity",
        subject: "alice",
        payload: { userId: expect.any(String), isAdmin: true, via: "cli" },
        occurredAt: T0.toISOString(),
      },
    ]);
  });

  it("用户名已存在，含只差大小写：回 username_taken，不算散列，不写库（I-48）", async () => {
    const { service, repo, hashes } = await setup({ users: [{ ...ALICE, username: "Alice" }] });
    for (const name of ["Alice", "alice", "ALICE"]) {
      expect(
        await service.createUser({ username: name, password: "long-enough-pw", isAdmin: false }),
      ).toEqual({
        kind: "rejected",
        reason: "username_taken",
      });
    }
    expect(repo.state.users).toHaveLength(1);
    expect(hashes).toEqual([]);
  });

  it("用户名不合规、口令太短、口令太长：各自被拒，不算散列，不写库（I-48）", async () => {
    const { service, repo, hashes } = await setup({ users: [] });
    const cases = [
      { username: "bad name", password: "long-enough-pw", reason: "invalid_username" },
      { username: "alice", password: "short-7", reason: "password_too_weak" },
      { username: "alice", password: "", reason: "password_too_weak" },
      { username: "alice", password: "x".repeat(129), reason: "password_too_long" },
    ];
    for (const entry of cases) {
      expect(
        await service.createUser({
          username: entry.username,
          password: entry.password,
          isAdmin: false,
        }),
      ).toEqual({ kind: "rejected", reason: entry.reason });
    }
    expect(repo.state.users).toEqual([]);
    expect(hashes).toEqual([]);
  });

  it("查重之后撞上库里的唯一索引（两个进程同时建号），也回 username_taken（I-34）", async () => {
    const { repo, eventLog } = await setup({ users: [] });
    const db = {
      transaction: async (): Promise<never> => {
        throw Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
        });
      },
    } as unknown as Db;
    const racing = createIdentityService({
      db,
      repo,
      eventLog,
      passwordMinLength: 8,
      password: { hash: async (p) => p, verify: async () => false },
    });
    expect(
      await racing.createUser({ username: "alice", password: "long-enough-pw", isAdmin: false }),
    ).toEqual({
      kind: "rejected",
      reason: "username_taken",
    });
    // 别的错照旧往外抛，不吞
    const broken = {
      transaction: async (): Promise<never> => {
        throw Object.assign(new Error("connection lost"), { code: "08006" });
      },
    } as unknown as Tx;
    await expect(
      createIdentityService({
        db: broken as unknown as Db,
        repo,
        eventLog,
        passwordMinLength: 8,
      }).createUser({
        username: "alice",
        password: "long-enough-pw",
        isAdmin: false,
      }),
    ).rejects.toThrow("connection lost");
  });
});

describe("停用", () => {
  it("停用时删光这个账号的会话，别的账号不受影响；重新启用后旧会话不会回来（I-29）", async () => {
    const { service, repo } = await setup({ users: [ALICE, BOB], withOthers: true });
    await service.setDisabled(ALICE.id, true);
    expect(repo.state.users[0]?.disabledAt).toEqual(T0);
    expect(repo.state.sessions.map((s) => s.userId)).toEqual([BOB.id]);
    expect(await service.authenticate("token-a")).toBeUndefined();
    await service.setDisabled(ALICE.id, false);
    expect(repo.state.users[0]?.disabledAt).toBeNull();
    expect(await service.authenticate("token-c")).toBeUndefined();
    expect(await service.authenticate("token-bob")).toMatchObject({ user: { username: "bob" } });
  });
});
