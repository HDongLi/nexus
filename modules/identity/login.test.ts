import { describe, expect, it } from "vitest";
import type { Tx } from "@nexus/db";
import { LOGIN_FAILED, LOGIN_SUCCEEDED } from "./events.ts";
import { LOCK_DURATION_MS, MAX_FAILURES } from "./lockout.ts";
import type { PasswordHasher } from "./password.ts";
import { hashToken } from "./tokens.ts";
import type { FailureRecord } from "./lockout.ts";
import type { UserRecord } from "./repo.ts";
import { createIdentityService } from "./service.ts";
import {
  createClock,
  createFakeEventLog,
  createFakeRepo,
  DAY_MS,
  fakeDb,
  T0,
  userRow,
  type FakeRepo,
} from "./testing/fake.ts";

const RIGHT = "right-password";
const WRONG = "wrong-password";

interface CountingHasher extends PasswordHasher {
  verifications: number;
}

/** 把散列函数换成计数桩：只数调用了几次，结果由调用方定。 */
function countingHasher(
  answer: (stored: string | null | undefined, password: string) => boolean,
): CountingHasher {
  const hasher = {
    verifications: 0,
    hash: async (password: string) => `hash:${password}`,
    verify: async (stored: string | null | undefined, password: string) => {
      hasher.verifications += 1;
      return answer(stored, password);
    },
  };
  return hasher;
}

function setup(options: { users?: UserRecord[]; hasher?: PasswordHasher; tx?: Tx } = {}) {
  const repo: FakeRepo = createFakeRepo({ users: options.users });
  const eventLog = createFakeEventLog();
  const clock = createClock();
  const tx = options.tx ?? ({} as Tx);
  const hasher: CountingHasher =
    (options.hasher as CountingHasher | undefined) ??
    countingHasher(
      (stored, password) => stored !== null && stored !== undefined && password === RIGHT,
    );
  const service = createIdentityService({
    db: fakeDb(tx),
    repo,
    eventLog,
    passwordMinLength: 8,
    now: clock.now,
    password: hasher,
  });
  const login = (username: string, password: string) =>
    service.login({ username, password, ip: "203.0.113.7", traceId: "trace-1" });
  const failures = (key: string): FailureRecord | undefined => repo.state.failures.get(key);
  return { service, repo, eventLog, clock, hasher, tx, login, failures };
}

describe("登录的检查顺序与回应", () => {
  it("口令对了：回人、令牌、过期时间，会话落库，发一条成功事件", async () => {
    const { service, repo, eventLog, login } = setup({ users: [userRow()] });
    const result = await login("alice", RIGHT);
    expect(result).toMatchObject({
      kind: "ok",
      user: { id: expect.any(String), username: "alice", isAdmin: false },
    });
    if (result.kind !== "ok") throw new Error("应当登录成功");
    // 时钟拨在 2026-11-27T00:00:00Z：有效期正好是 30 天
    expect(result.expiresAt).toEqual(new Date("2026-12-27T00:00:00.000Z"));
    expect(repo.state.sessions).toHaveLength(1);
    expect(repo.state.sessions[0]?.userId).toBe(userRow().id);
    // 登录回的人就是后来凭令牌认出来的人
    expect(await service.authenticate(result.token)).toMatchObject({
      renewed: false,
      user: { username: "alice" },
    });
    expect(eventLog.emitted.map((e) => e.type)).toEqual([LOGIN_SUCCEEDED]);
    // 带当事人的账号编号：用户名以后可能允许改，编号才不变（规格事件表）
    expect(eventLog.emitted[0]).toMatchObject({
      source: "identity",
      subject: "alice",
      payload: { userId: userRow().id, ip: "203.0.113.7" },
      traceId: "trace-1",
    });
  });

  it("停用账号：口令错是「不对」，口令对才是「停用」（I-09）", async () => {
    const disabled = new Date("2026-11-20T00:00:00.000Z");
    const { login, eventLog } = setup({ users: [userRow({ disabledAt: disabled })] });
    expect(await login("alice", WRONG)).toEqual({ kind: "invalid" });
    expect(await login("alice", RIGHT)).toEqual({ kind: "disabled" });
    expect(eventLog.emitted.map((e) => [e.type, (e.payload as { reason: string }).reason])).toEqual(
      [
        [LOGIN_FAILED, "invalid_credentials"],
        [LOGIN_FAILED, "account_disabled"],
      ],
    );
  });

  it("用户名不存在、账号没有口令、口令不对：回同一个结果，事件也长得一样（I-10）", async () => {
    const { login, eventLog } = setup({
      users: [
        userRow(),
        userRow({
          id: "10000000-0000-4000-8000-000000000002",
          username: "nopass",
          passwordHash: null,
        }),
      ],
    });
    const results = [
      await login("ghost", "whatever-1"),
      await login("nopass", "whatever-1"),
      await login("alice", "whatever-1"),
    ];
    expect(results).toEqual([{ kind: "invalid" }, { kind: "invalid" }, { kind: "invalid" }]);
    const shapes = eventLog.emitted.map((e) => ({
      type: e.type,
      source: e.source,
      payload: e.payload,
      traceId: e.traceId,
    }));
    expect(shapes[0]).toEqual(shapes[1]);
    expect(shapes[1]).toEqual(shapes[2]);
    // subject 是各自提交的用户名，这是三者之间唯一允许的差别
    expect(eventLog.emitted.map((e) => e.subject)).toEqual(["ghost", "nopass", "alice"]);
  });

  it("四种情形都恰好做一次口令校验（I-11）", async () => {
    const { hasher, login } = setup({
      users: [
        userRow(),
        userRow({
          id: "10000000-0000-4000-8000-000000000002",
          username: "nopass",
          passwordHash: null,
        }),
      ],
    });
    await login("ghost", "whatever-1");
    expect(hasher.verifications).toBe(1);
    await login("nopass", "whatever-1");
    expect(hasher.verifications).toBe(2);
    await login("alice", WRONG);
    expect(hasher.verifications).toBe(3);
    await login("alice", RIGHT);
    expect(hasher.verifications).toBe(4);
  });
});

describe("记失败与锁定", () => {
  it("失败记在提交的用户名上，不分大小写；用户名不存在也同样记（I-12）", async () => {
    const { login, failures } = setup({ users: [userRow()] });
    await login("Alice", WRONG);
    await login("ALICE", WRONG);
    await login("ghost", WRONG);
    expect(failures("alice")).toMatchObject({
      username: "alice",
      failureCount: 2,
      lockedUntil: null,
    });
    expect(failures("ghost")).toMatchObject({ username: "ghost", failureCount: 1 });
  });

  it("连错到第 5 次进入锁定，第 6 次被拒（I-13）", async () => {
    const { login, failures } = setup({ users: [userRow()] });
    // 阈值写死成 5，不用 MAX_FAILURES：这条用例钉的就是「5」这个值本身，
    // 引常量自指的话，实现把阈值改错它也不会红（2026-11-28 审查 D-02）。
    for (let i = 1; i < 5; i++) expect(await login("alice", WRONG)).toEqual({ kind: "invalid" });
    expect(failures("alice")?.lockedUntil).toBeNull();
    // 第 5 次失败本身就是触发锁定的那一次，对调用方仍然是「不对」
    expect(await login("alice", WRONG)).toEqual({ kind: "invalid" });
    expect(failures("alice")?.failureCount).toBe(5);
    expect(MAX_FAILURES).toBe(5);
    expect(await login("alice", RIGHT)).toEqual({ kind: "locked", retryAfterSeconds: 900 });
  });

  it("锁定从第 5 次失败那一刻算起；满 900 秒后解锁，再错按新的窗口重新计数（I-13）", async () => {
    const { login, clock, failures } = setup({ users: [userRow()] });
    for (let i = 0; i < 4; i++) await login("alice", WRONG);
    clock.tick(600_000);
    const fifthAt = clock.now().getTime();
    await login("alice", WRONG);
    expect(failures("alice")?.lockedUntil?.getTime()).toBe(fifthAt + LOCK_DURATION_MS);
    clock.tick(LOCK_DURATION_MS - 1_000);
    expect(await login("alice", WRONG)).toMatchObject({ kind: "locked", retryAfterSeconds: 1 });
    clock.tick(1_000);
    expect(await login("alice", WRONG)).toEqual({ kind: "invalid" });
    expect(failures("alice")).toMatchObject({ failureCount: 1, lockedUntil: null });
  });

  it("还要等的秒数向下取整，最小 1（I-14）", async () => {
    const { login, clock } = setup({ users: [userRow()] });
    for (let i = 0; i < MAX_FAILURES; i++) await login("alice", WRONG);
    const lockedAt = clock.now().getTime();
    expect(await login("alice", RIGHT)).toEqual({ kind: "locked", retryAfterSeconds: 900 });
    // 过了半秒：还剩 899.5 秒，说 899，不说 900
    clock.tick(500);
    expect(await login("alice", RIGHT)).toEqual({ kind: "locked", retryAfterSeconds: 899 });
    // 只剩半秒：取整是 0，也要说至少 1
    clock.tick(LOCK_DURATION_MS - 1_000);
    expect(clock.now().getTime() - lockedAt).toBe(LOCK_DURATION_MS - 500);
    expect(await login("alice", RIGHT)).toEqual({ kind: "locked", retryAfterSeconds: 1 });
  });

  it("锁定期间不验口令，口令对了也进不来，失败记录不再变（I-14）", async () => {
    const { hasher, login, failures } = setup({ users: [userRow()] });
    for (let i = 0; i < MAX_FAILURES; i++) await login("alice", WRONG);
    const before = { ...failures("alice") };
    expect(await login("alice", RIGHT)).toEqual({ kind: "locked", retryAfterSeconds: 900 });
    expect(hasher.verifications).toBe(MAX_FAILURES);
    expect(failures("alice")).toEqual(before);
  });

  it("被锁定的拒绝也发一条事件，理由是 locked_out（I-39）", async () => {
    const { login, eventLog } = setup({ users: [userRow()] });
    for (let i = 0; i < MAX_FAILURES; i++) await login("alice", WRONG);
    await login("alice", RIGHT);
    expect(eventLog.emitted.at(-1)).toMatchObject({
      type: LOGIN_FAILED,
      subject: "alice",
      payload: { ip: "203.0.113.7", reason: "locked_out" },
    });
  });

  it("登录成功删掉这个用户名的失败记录，之后再错 4 次都不锁（I-16）", async () => {
    const { login, failures } = setup({ users: [userRow()] });
    for (let i = 0; i < 4; i++) await login("alice", WRONG);
    expect(await login("alice", RIGHT)).toMatchObject({ kind: "ok" });
    expect(failures("alice")).toBeUndefined();
    for (let i = 0; i < 4; i++) expect(await login("alice", WRONG)).toEqual({ kind: "invalid" });
    expect(failures("alice")?.lockedUntil).toBeNull();
  });

  it("锁住一个用户名，不影响别的用户名登录（I-17）", async () => {
    const bob = userRow({ id: "10000000-0000-4000-8000-000000000003", username: "bob" });
    const { login } = setup({ users: [userRow(), bob] });
    for (let i = 0; i < MAX_FAILURES; i++) await login("alice", WRONG);
    expect(await login("bob", RIGHT)).toMatchObject({ kind: "ok" });
  });

  it("每次记失败时顺手删掉全表窗口外的记录；窗口结束但还在锁的不删（I-12）", async () => {
    const { login, repo, clock } = setup({ users: [userRow()] });
    const old = new Date(clock.now().getTime() - 2 * 60 * 60 * 1000);
    repo.state.failures.set("carol", {
      username: "carol",
      failureCount: 2,
      windowStartedAt: old,
      lockedUntil: null,
    });
    repo.state.failures.set("dave", {
      username: "dave",
      failureCount: 5,
      windowStartedAt: old,
      lockedUntil: new Date(clock.now().getTime() + 60 * 60 * 1000),
    });
    await login("alice", WRONG);
    expect([...repo.state.failures.keys()].sort()).toEqual(["alice", "dave"]);
  });
});

describe("会话的有效期与顺延", () => {
  const open = async (repo: FakeRepo, token: string, ttlMs: number) => {
    await repo.sessions.insert(fakeDb(), {
      id: "20000000-0000-4000-8000-000000000001",
      userId: userRow().id,
      tokenHash: await hashToken(token),
      createdAt: T0,
      lastSeenAt: T0,
      expiresAt: new Date(T0.getTime() + ttlMs),
    });
  };

  it("剩余还多的时候不动库（I-22）", async () => {
    const { service, repo, clock } = setup({ users: [userRow()] });
    await open(repo, "token-a", 30 * DAY_MS);
    clock.tick(14 * DAY_MS);
    expect(await service.authenticate("token-a")).toEqual({
      user: expect.objectContaining({ username: "alice" }),
      renewed: false,
    });
    expect(repo.state.sessions[0]?.expiresAt).toEqual(new Date(T0.getTime() + 30 * DAY_MS));
  });

  it("剩余不足 15 天时续到此刻加 30 天；一直用就一直有效（I-22）", async () => {
    const { service, repo, clock } = setup({ users: [userRow()] });
    await open(repo, "token-a", 30 * DAY_MS);
    clock.tick(16 * DAY_MS);
    expect(await service.authenticate("token-a")).toMatchObject({ renewed: true });
    // 第 46 天
    expect(repo.state.sessions[0]?.expiresAt).toEqual(new Date(T0.getTime() + 46 * DAY_MS));
    clock.tick(24 * DAY_MS);
    expect(await service.authenticate("token-a")).toMatchObject({ renewed: true });
    expect(repo.state.sessions[0]?.expiresAt).toEqual(new Date(T0.getTime() + 70 * DAY_MS));
  });

  it("一直没用，满 30 天就失效；过期之后不续（I-22、I-23）", async () => {
    const { service, repo, clock } = setup({ users: [userRow()] });
    await open(repo, "token-a", 30 * DAY_MS);
    clock.tick(30 * DAY_MS - 1);
    expect(await service.authenticate("token-a")).toMatchObject({ renewed: true });
    await open(repo, "token-b", 30 * DAY_MS);
    clock.tick(1);
    expect(await service.authenticate("token-b")).toBeUndefined();
    expect(await service.authenticate("forged-token")).toBeUndefined();
  });

  it("账号停用之后，带着有效会话也认不出，并且这条会话被删掉（设计 01 访问闸第 3 步）", async () => {
    const { service, repo } = setup({
      users: [userRow({ disabledAt: new Date("2026-11-20T00:00:00.000Z") })],
    });
    await open(repo, "token-a", 30 * DAY_MS);
    expect(await service.authenticate("token-a")).toBeUndefined();
    expect(repo.state.sessions).toEqual([]);
  });
});

describe("事件和写入在同一个事务里", () => {
  it("登录成功：会话、失败记录的删除、事件都交给了同一个事务（I-41）", async () => {
    const tx = { fake: "tx" } as unknown as Tx;
    const { repo, eventLog, login } = setup({ users: [userRow()], tx });
    await login("alice", WRONG);
    await login("alice", RIGHT);
    // 两次失败记录的写入和两条事件，全部落在同一个事务对象上
    expect(eventLog.executors).toEqual([tx, tx]);
    expect(repo.state.sessions).toHaveLength(1);
  });
});
