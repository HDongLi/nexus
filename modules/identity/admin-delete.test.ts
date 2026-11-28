import { describe, expect, it } from "vitest";
import { USER_DELETED } from "./events.ts";
import { createIdentityService } from "./service.ts";
import {
  createClock,
  createFakeEventLog,
  createFakeRepo,
  fakeDb,
  groupRow,
  T0,
  userRow,
  type FakeRepo,
} from "./testing/fake.ts";

/**
 * 删号用例的单元测试（人员规格 G-21 到 G-23，2026-11-28）。不碰数据库；
 * 管账号的其余用例在 admin-accounts.test.ts，护栏的两个 409 谁先说也在那边。
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

describe("删号（规格 G-21 到 G-23）", () => {
  it("建过工程的删不掉：库的引用约束拒绝，用例翻译成 has_projects；什么都没写（G-21）", async () => {
    // 照真库的形状抛：AGENTS.md 的坑——错误码在 cause 链上，两个码都要认（这里钉 23001 这个）
    const restrict = new Error('Failed query: delete from "identity_users"', {
      cause: Object.assign(new Error("update or delete on table row violates restrict"), {
        code: "23001",
      }),
    });
    const { service, repo, eventLog } = await setup(
      [chief(), userRow({ id: BOB_ID, username: "bob" })],
      {
        failOnUserDelete: restrict,
      },
    );
    const result = await service.deleteAccount({ ...TRACE, operatorId: CHIEF_ID, userId: BOB_ID });
    expect(result).toEqual({ kind: "has_projects" });
    expect(repo.state.users).toHaveLength(2);
    expect(eventLog.emitted).toEqual([]);
  });

  it("删号：会话、成员关系随账号一起没，事件带上删前的组（G-22）", async () => {
    const group = groupRow();
    const { service, repo, eventLog } = await setup([
      chief(),
      userRow({ id: BOB_ID, username: "bob" }),
    ]);
    repo.state.groups.push(group);
    repo.state.members.push({ groupId: group.id, userId: BOB_ID });
    await repo.sessions.insert(fakeDb(), {
      id: "30000000-0000-4000-8000-000000000001",
      userId: BOB_ID,
      tokenHash: "token-hash-bob",
      createdAt: T0,
      lastSeenAt: T0,
      expiresAt: new Date(T0.getTime() + 20 * 24 * 60 * 60 * 1000),
    });
    const result = await service.deleteAccount({ ...TRACE, operatorId: CHIEF_ID, userId: BOB_ID });
    expect(result).toEqual({ kind: "ok", groupIds: [group.id] });
    expect(repo.state.users.map((user) => user.id)).toEqual([CHIEF_ID]);
    expect(repo.state.sessions).toEqual([]);
    expect(repo.state.members).toEqual([]);
    expect(eventLog.emitted.map((event) => event.type)).toEqual([USER_DELETED]);
    expect(eventLog.emitted[0]?.subject).toBe("bob");
    expect(eventLog.emitted[0]?.payload).toEqual({
      userId: BOB_ID,
      actorId: CHIEF_ID,
      groupIds: [group.id],
    });
  });

  it("删自己（还有一个启用的管理员时）回 self_change；最后一个管理员删自己回 last_admin（G-18、G-19）", async () => {
    const { service, repo, eventLog } = await setup([
      chief(),
      userRow({ id: BOB_ID, username: "bob", isAdmin: true }),
    ]);
    expect(
      await service.deleteAccount({ ...TRACE, operatorId: CHIEF_ID, userId: CHIEF_ID }),
    ).toEqual({ kind: "self_change" });
    expect(repo.state.users).toHaveLength(2);
    expect(eventLog.emitted).toEqual([]);
    // 只剩 chief 一个启用的管理员：删自己是「动自己」也是「失去最后一个」，数量那道闸先说
    const lone = await setup([chief()]);
    expect(
      await lone.service.deleteAccount({ ...TRACE, operatorId: CHIEF_ID, userId: CHIEF_ID }),
    ).toEqual({ kind: "last_admin" });
    expect(lone.repo.state.users).toHaveLength(1);
    expect(lone.eventLog.emitted).toEqual([]);
  });

  it("找不到的账号回 not_found（G-01 的表）", async () => {
    const { service } = await setup([chief()]);
    expect(
      await service.deleteAccount({
        ...TRACE,
        operatorId: CHIEF_ID,
        userId: "30000000-0000-4000-8000-0000000000ff",
      }),
    ).toEqual({ kind: "not_found" });
  });
});
