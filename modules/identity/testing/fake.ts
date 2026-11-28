import type { Db, Executor, Tx } from "@nexus/db";
import type { EmitInput, EventRecord } from "@nexus/event-log";
import { FAILURE_WINDOW_MS, type FailureRecord } from "../lockout.ts";
import type {
  GroupMemberRecord,
  GroupRecord,
  IdentityRepo,
  NewGroup,
  NewSession,
  NewUser,
  SessionRecord,
  UserRecord,
} from "../repo.ts";

/**
 * 给单元测试用的替身：仓储、数据库、事件日志、时钟都放在内存里，不碰真的库。
 * 仓储的语义照 repo.ts 的 SQL 写，包括「占位加行锁」那一步的效果（同一把键的失败只会串着数）。
 * 文件名不带 .test，所以 vitest 不把它当测试跑；它只有测试会 import。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-27T00:00:00.000Z");

export function userRow(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    username: "alice",
    displayName: "alice",
    passwordHash:
      "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    isAdmin: false,
    disabledAt: null,
    passwordChangedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** 一个用户组；memberIds 不在组这一行上，另外往 state.members 里放。 */
export function groupRow(overrides: Partial<GroupRecord> = {}): GroupRecord {
  return {
    id: "20000000-0000-4000-8000-00000000000a",
    name: "dev",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export interface FakeRepo extends IdentityRepo {
  state: {
    users: UserRecord[];
    sessions: SessionRecord[];
    failures: Map<string, FailureRecord>;
    groups: GroupRecord[];
    /** 成员关系，(groupId, userId) 一行，写入的先后就是数组的先后。 */
    members: GroupMemberRecord[];
    /** 设了，删账号（或任何 users.delete）时照真库的形状抛引用约束：建过工程的删不掉。 */
    failOnUserDelete?: unknown;
    /** 设了，插用户组（或任何 groups.insert）时照真库的形状抛唯一约束：组名撞了。 */
    failOnGroupInsert?: unknown;
  };
}

export function createFakeRepo(
  seed: {
    users?: UserRecord[] | undefined;
    sessions?: SessionRecord[] | undefined;
    groups?: GroupRecord[] | undefined;
    members?: GroupMemberRecord[] | undefined;
  } = {},
): FakeRepo {
  // 预置的行复制一份再收：用例会就地改它们，直接收引用的话，一个测试改过的行会漏给下一个测试。
  const state: FakeRepo["state"] = {
    users: (seed.users ?? []).map((user) => ({ ...user })),
    sessions: (seed.sessions ?? []).map((session) => ({ ...session })),
    failures: new Map(),
    groups: (seed.groups ?? []).map((group) => ({ ...group })),
    members: (seed.members ?? []).map((member) => ({ ...member })),
  };
  const touch = (user: UserRecord | undefined, at: Date): UserRecord | undefined => {
    if (user) user.updatedAt = at;
    return user;
  };
  return {
    state,
    users: {
      async findByUsername(_ex, usernameLower) {
        return state.users.find((user) => user.username.toLowerCase() === usernameLower);
      },
      async findById(_ex, id) {
        return state.users.find((user) => user.id === id);
      },
      async insert(_ex, row: NewUser) {
        const stored = { ...row } as UserRecord;
        state.users.push(stored);
        return stored;
      },
      async updatePasswordHash(_ex, id, passwordHash, at) {
        const user = touch(
          state.users.find((u) => u.id === id),
          at,
        );
        if (user) user.passwordHash = passwordHash;
      },
      async setDisplayName(_ex, id, displayName, at) {
        const user = touch(
          state.users.find((u) => u.id === id),
          at,
        );
        if (user) user.displayName = displayName;
      },
      async setIsAdmin(_ex, id, isAdmin, at) {
        const user = touch(
          state.users.find((u) => u.id === id),
          at,
        );
        if (user) user.isAdmin = isAdmin;
      },
      async setDisabledAt(_ex, id, disabledAt, at) {
        const user = touch(
          state.users.find((u) => u.id === id),
          at,
        );
        if (user) user.disabledAt = disabledAt;
      },
      async delete(_ex, id) {
        // 真库先拒绝、什么都没动（规格 G-21）；这里也先抛，行都留着。
        if (state.failOnUserDelete !== undefined) throw state.failOnUserDelete;
        // 会话和成员关系随外键级联；这里照真库的形状一并摘掉。
        state.sessions = state.sessions.filter((session) => session.userId !== id);
        state.members = state.members.filter((member) => member.userId !== id);
        state.users = state.users.filter((user) => user.id !== id);
      },
      async listAll(_ex) {
        return [...state.users]
          .sort((a, b) => (a.username < b.username ? -1 : 1))
          .map((user) => ({ ...user }));
      },
      async listEnabled(_ex) {
        return [...state.users]
          .filter((user) => user.disabledAt === null)
          .sort((a, b) => (a.username < b.username ? -1 : 1))
          .map((user) => ({ ...user }));
      },
      async existingIds(_ex, ids) {
        const known = new Set(state.users.map((user) => user.id));
        return ids.filter((id) => known.has(id));
      },
      async lockEnabledAdmins(_ex: Executor) {
        return state.users.filter((user) => user.isAdmin && user.disabledAt === null).length;
      },
    },
    sessions: {
      async findByTokenHash(_ex, tokenHash) {
        return state.sessions.find((session) => session.tokenHash === tokenHash);
      },
      async insert(_ex, row: NewSession) {
        const stored = { ...row } as SessionRecord;
        state.sessions.push(stored);
        return stored;
      },
      async renew(_ex, id, expiresAt, at) {
        const session = state.sessions.find((s) => s.id === id);
        if (session) {
          session.expiresAt = expiresAt;
          session.lastSeenAt = at;
        }
      },
      async rotate(_ex, id, tokenHash, expiresAt, at) {
        const session = state.sessions.find((s) => s.id === id);
        if (session) {
          session.tokenHash = tokenHash;
          session.expiresAt = expiresAt;
          session.lastSeenAt = at;
        }
      },
      async delete(_ex, id) {
        const before = state.sessions.length;
        state.sessions = state.sessions.filter((session) => session.id !== id);
        return state.sessions.length !== before;
      },
      async deleteExpired(_ex, now) {
        const alive = state.sessions.filter(
          (session) => session.expiresAt.getTime() > now.getTime(),
        );
        const count = state.sessions.length - alive.length;
        state.sessions = alive;
        return count;
      },
      async deleteOthers(_ex, userId, keepId) {
        const alive = state.sessions.filter(
          (session) => session.userId !== userId || session.id === keepId,
        );
        const count = state.sessions.length - alive.length;
        state.sessions = alive;
        return count;
      },
      async deleteAllForUser(_ex, userId) {
        const alive = state.sessions.filter((session) => session.userId !== userId);
        const count = state.sessions.length - alive.length;
        state.sessions = alive;
        return count;
      },
    },
    failures: {
      async get(_ex, key) {
        return state.failures.get(key);
      },
      async lock(_ex, key, at) {
        if (!state.failures.has(key)) {
          state.failures.set(key, {
            username: key,
            failureCount: 0,
            windowStartedAt: at,
            lockedUntil: null,
          });
        }
        return state.failures.get(key) as FailureRecord;
      },
      async put(_ex, record) {
        state.failures.set(record.username, { ...record });
      },
      async delete(_ex, key) {
        state.failures.delete(key);
      },
      async prune(_ex, ownKey, now) {
        const windowStart = now.getTime() - FAILURE_WINDOW_MS;
        let count = 0;
        for (const [key, record] of state.failures) {
          // 和真仓储一样：自己那一行不归这一回删
          const expired =
            key !== ownKey &&
            record.windowStartedAt.getTime() < windowStart &&
            (record.lockedUntil === null || record.lockedUntil.getTime() <= now.getTime());
          if (expired) {
            state.failures.delete(key);
            count += 1;
          }
        }
        return count;
      },
    },
    groups: {
      async findById(_ex, id) {
        return state.groups.find((group) => group.id === id);
      },
      async findByNameLower(_ex, nameLower) {
        return state.groups.find((group) => group.name.toLowerCase() === nameLower);
      },
      async listAll(_ex) {
        // 创建早的在前（规格 G-01 的表）；同一时刻的按编号排，次序才稳定。
        return [...state.groups]
          .sort(
            (a, b) =>
              a.createdAt.getTime() - b.createdAt.getTime() ||
              (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
          )
          .map((group) => ({ ...group }));
      },
      async insert(_ex, row: NewGroup) {
        if (state.failOnGroupInsert !== undefined) throw state.failOnGroupInsert;
        const stored = { ...row } as GroupRecord;
        state.groups.push(stored);
        return stored;
      },
      async rename(_ex, id, name, at) {
        const group = state.groups.find((g) => g.id === id);
        if (group) {
          group.name = name;
          group.updatedAt = at;
        }
      },
      async delete(_ex, id) {
        // 成员关系随外键级联；工程模块的关系表是它自己的事，这里管不着。
        state.members = state.members.filter((member) => member.groupId !== id);
        state.groups = state.groups.filter((group) => group.id !== id);
      },
      async memberIds(_ex, groupId) {
        // 按编号排，和真仓储同一个次序（repo.ts 的 memberIds）。
        return state.members
          .filter((member) => member.groupId === groupId)
          .map((member) => member.userId)
          .sort();
      },
      async memberCount(_ex, groupId) {
        return state.members.filter((member) => member.groupId === groupId).length;
      },
      async replaceMembers(_ex, groupId, userIds) {
        state.members = state.members.filter((member) => member.groupId !== groupId);
        for (const userId of userIds) state.members.push({ groupId, userId });
      },
      async groupIdsForUser(_ex, userId) {
        return state.members
          .filter((member) => member.userId === userId)
          .map((member) => member.groupId)
          .sort();
      },
    },
  };
}

const fakeTx = { fake: "tx" } as unknown as Tx;

/** 一个假数据库：开事务就是把事务对象原样交给回调，不做回滚（单元测试不验回滚，那是集成测试的事）。 */
export function fakeDb(tx: Tx = fakeTx): Db {
  return { transaction: (work: (t: Tx) => Promise<unknown>) => work(tx) } as unknown as Db;
}

export interface FakeEventLog {
  emit(input: EmitInput, tx?: Tx): Promise<EventRecord>;
  emitted: EmitInput[];
  /** 每条事件是在哪个执行者上写的：undefined 是没开事务，否则是那个事务对象。 */
  executors: (Tx | undefined)[];
}

export function createFakeEventLog(): FakeEventLog {
  const emitted: EmitInput[] = [];
  const executors: (Tx | undefined)[] = [];
  return {
    emitted,
    executors,
    async emit(input, tx) {
      emitted.push(input);
      executors.push(tx);
      return {
        id: emitted.length,
        type: input.type,
        source: input.source,
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        payload: input.payload,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
      };
    },
  };
}

/** 可以拨的时钟。 */
export interface Clock {
  now(): Date;
  tick(ms: number): void;
}

export function createClock(start: Date = T0): Clock {
  const current = new Date(start.getTime());
  return {
    now: () => new Date(current.getTime()),
    tick: (ms) => {
      current.setTime(current.getTime() + ms);
    },
  };
}

export { DAY_MS, T0 };
