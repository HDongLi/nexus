import type { Executor } from "@nexus/db";
import { and, asc, eq, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { FAILURE_WINDOW_MS, type FailureRecord } from "./lockout.ts";
import {
  identityGroupMembers,
  identityGroups,
  identityLoginFailures,
  identitySessions,
  identityUsers,
} from "./schema.ts";

/**
 * 本模块唯一写 SQL 的地方（铁律 4）。做成接口是为了能单独换成假的来测用例，也能在写入后故意抛错
 * 来验「事件和写入同一个事务」（规格 I-41）。每个方法都收一个执行者：连接池，或者调用方打开的事务。
 */

export type UserRecord = typeof identityUsers.$inferSelect;
export type NewUser = typeof identityUsers.$inferInsert;
export type SessionRecord = typeof identitySessions.$inferSelect;
export type NewSession = typeof identitySessions.$inferInsert;
export type GroupRecord = typeof identityGroups.$inferSelect;
export type NewGroup = typeof identityGroups.$inferInsert;
export type GroupMemberRecord = typeof identityGroupMembers.$inferSelect;
export type NewGroupMember = typeof identityGroupMembers.$inferInsert;
type FailureRow = typeof identityLoginFailures.$inferSelect;

export interface UserRepo {
  /** 按小写的用户名找。用户名不许两个只差大小写，所以这样找不会有两个结果。 */
  findByUsername(ex: Executor, usernameLower: string): Promise<UserRecord | undefined>;
  findById(ex: Executor, id: string): Promise<UserRecord | undefined>;
  insert(ex: Executor, row: NewUser): Promise<UserRecord>;
  updatePasswordHash(ex: Executor, id: string, passwordHash: string, at: Date): Promise<void>;
  setDisplayName(ex: Executor, id: string, displayName: string, at: Date): Promise<void>;
  setIsAdmin(ex: Executor, id: string, isAdmin: boolean, at: Date): Promise<void>;
  setDisabledAt(ex: Executor, id: string, disabledAt: Date | null, at: Date): Promise<void>;
  /** 删掉账号这一行；会话和组成员关系随外键级联。工程表会拦住建过工程的（规格 G-21）。 */
  delete(ex: Executor, id: string): Promise<void>;
  /** 全部账号，用户名升序（规格 G-06）。停用的也在内。 */
  listAll(ex: Executor): Promise<UserRecord[]>;
  /** 全部启用的账号，用户名升序（规格 G-07）。 */
  listEnabled(ex: Executor): Promise<UserRecord[]>;
  /** 这些编号里真实存在的（停用的也算存在，规格 G-27）。回存在的编号本身。 */
  existingIds(ex: Executor, ids: string[]): Promise<string[]>;
  /**
   * 锁住全部「管理员位为真且没停用」的行，回锁到的行数（规格 G-20）。
   * 数出来是 1 以外就还有别的启用管理员，降级、停用、删号都动得；数出来是 1 就是最后一个。
   * 系统始终至少有一个启用的管理员，总有行可锁，不用占位。
   */
  lockEnabledAdmins(tx: Executor): Promise<number>;
}

export interface SessionRepo {
  findByTokenHash(ex: Executor, tokenHash: string): Promise<SessionRecord | undefined>;
  insert(ex: Executor, row: NewSession): Promise<SessionRecord>;
  /** 续期：过期时间挪到 expiresAt，顺手记下这一次是什么时候。 */
  renew(ex: Executor, id: string, expiresAt: Date, at: Date): Promise<void>;
  /** 给当前会话换一枚令牌（改密之后）。 */
  rotate(ex: Executor, id: string, tokenHash: string, expiresAt: Date, at: Date): Promise<void>;
  /** 回 true 表示确实删了一行。 */
  delete(ex: Executor, id: string): Promise<boolean>;
  /** 删掉已经过期的会话行，回删掉的行数。 */
  deleteExpired(ex: Executor, now: Date): Promise<number>;
  /** 删掉这个人除 keepId 之外的会话，回删掉的行数。 */
  deleteOthers(ex: Executor, userId: string, keepId: string): Promise<number>;
  deleteAllForUser(ex: Executor, userId: string): Promise<number>;
}

export interface LockoutRepo {
  get(ex: Executor, key: string): Promise<FailureRecord | undefined>;
  /**
   * 锁住这一把键的记录，事务提交之前别人改不了它；没有记录就先放一行计数为 0 的占位。
   * 「先读后写」在并发下会丢数：两个请求同时读到 3，各自写成 4，两次失败只记了一次，
   * 连错的次数就永远数不到 5。占位加行锁让「读、加一、写」连成一步。
   */
  lock(ex: Executor, key: string, at: Date): Promise<FailureRecord>;
  put(ex: Executor, record: FailureRecord): Promise<void>;
  delete(ex: Executor, key: string): Promise<void>;
  /**
   * 删掉全表里窗口已经结束、也没在锁的记录，回删掉的行数。自己这一把键不碰。
   * 别的请求正锁着的记录跳过、不等：真 Postgres 上并发的两个请求各锁着一行、又都去扫全表，
   * 互相等就得等死；不等的话，被跳过的那几行留给下一次失败去删。
   */
  prune(ex: Executor, ownKey: string, now: Date): Promise<number>;
}

export interface GroupRepo {
  findById(ex: Executor, id: string): Promise<GroupRecord | undefined>;
  /** 按小写的组名找。组名不许两个只差大小写，所以这样找不会有两个结果（规格 G-25）。 */
  findByNameLower(ex: Executor, nameLower: string): Promise<GroupRecord | undefined>;
  /** 全部用户组，创建早的在前（规格 G-01 的表）。 */
  listAll(ex: Executor): Promise<GroupRecord[]>;
  insert(ex: Executor, row: NewGroup): Promise<GroupRecord>;
  rename(ex: Executor, id: string, name: string, at: Date): Promise<void>;
  /** 删掉组这一行；成员关系随外键级联（规格 G-30）。 */
  delete(ex: Executor, id: string): Promise<void>;
  /** 一个组的成员编号，按成员关系写入的先后。 */
  memberIds(ex: Executor, groupId: string): Promise<string[]>;
  /** 一个组的成员数（删组的事件里要带，规格事件表）。 */
  memberCount(ex: Executor, groupId: string): Promise<number>;
  /** 整体替换一个组的成员：先删光再按给定顺序插回去（规格 G-28）。 */
  replaceMembers(tx: Executor, groupId: string, userIds: string[]): Promise<void>;
  /** 这个人所属的用户组编号。停用不摘组，行一直在（规格 G-17）。 */
  groupIdsForUser(ex: Executor, userId: string): Promise<string[]>;
}

/** 占位行插进去到读出来之间，可能被另一个事务删掉。最多试这么多回。 */
const LOCK_ATTEMPTS = 3;

export interface IdentityRepo {
  users: UserRepo;
  sessions: SessionRepo;
  failures: LockoutRepo;
  groups: GroupRepo;
}

function toFailure(row: FailureRow): FailureRecord {
  return {
    username: row.username,
    failureCount: row.failureCount,
    windowStartedAt: row.windowStartedAt,
    lockedUntil: row.lockedUntil,
  };
}

const users: UserRepo = {
  async findByUsername(ex, usernameLower) {
    const rows = await ex
      .select()
      .from(identityUsers)
      .where(sql`lower(${identityUsers.username}) = ${usernameLower}`);
    return rows[0];
  },
  async findById(ex, id) {
    const rows = await ex.select().from(identityUsers).where(eq(identityUsers.id, id));
    return rows[0];
  },
  async insert(ex, row) {
    const rows = await ex.insert(identityUsers).values(row).returning();
    const inserted = rows[0];
    if (!inserted) throw new Error("账号写进去了却读不回来");
    return inserted;
  },
  async updatePasswordHash(ex, id, passwordHash, at) {
    await ex
      .update(identityUsers)
      .set({ passwordHash, passwordChangedAt: at, updatedAt: at })
      .where(eq(identityUsers.id, id));
  },
  async setDisplayName(ex, id, displayName, at) {
    await ex
      .update(identityUsers)
      .set({ displayName, updatedAt: at })
      .where(eq(identityUsers.id, id));
  },
  async setIsAdmin(ex, id, isAdmin, at) {
    await ex.update(identityUsers).set({ isAdmin, updatedAt: at }).where(eq(identityUsers.id, id));
  },
  async setDisabledAt(ex, id, disabledAt, at) {
    await ex
      .update(identityUsers)
      .set({ disabledAt, updatedAt: at })
      .where(eq(identityUsers.id, id));
  },
  async delete(ex, id) {
    await ex.delete(identityUsers).where(eq(identityUsers.id, id));
  },
  async listAll(ex) {
    return ex.select().from(identityUsers).orderBy(asc(identityUsers.username));
  },
  async listEnabled(ex) {
    return ex
      .select()
      .from(identityUsers)
      .where(isNull(identityUsers.disabledAt))
      .orderBy(asc(identityUsers.username));
  },
  async existingIds(ex, ids) {
    if (ids.length === 0) return [];
    const rows = await ex
      .select({ id: identityUsers.id })
      .from(identityUsers)
      .where(inArray(identityUsers.id, ids));
    return rows.map((row) => row.id);
  },
  async lockEnabledAdmins(ex) {
    const rows = await ex
      .select()
      .from(identityUsers)
      .where(and(eq(identityUsers.isAdmin, true), isNull(identityUsers.disabledAt)))
      .for("update");
    return rows.length;
  },
};

const groups: GroupRepo = {
  async findById(ex, id) {
    const rows = await ex.select().from(identityGroups).where(eq(identityGroups.id, id));
    return rows[0];
  },
  async findByNameLower(ex, nameLower) {
    const rows = await ex
      .select()
      .from(identityGroups)
      .where(sql`lower(${identityGroups.name}) = ${nameLower}`);
    return rows[0];
  },
  async listAll(ex) {
    // 创建早的在前（规格 G-01 的表）；同一时刻的按编号排，次序才稳定。
    return ex
      .select()
      .from(identityGroups)
      .orderBy(asc(identityGroups.createdAt), asc(identityGroups.id));
  },
  async insert(ex, row) {
    const rows = await ex.insert(identityGroups).values(row).returning();
    const inserted = rows[0];
    if (!inserted) throw new Error("用户组写进去了却读不回来");
    return inserted;
  },
  async rename(ex, id, name, at) {
    await ex.update(identityGroups).set({ name, updatedAt: at }).where(eq(identityGroups.id, id));
  },
  async delete(ex, id) {
    await ex.delete(identityGroups).where(eq(identityGroups.id, id));
  },
  async memberIds(ex, groupId) {
    // 按编号排：集合的顺序本不表示什么（规格「路由与总则」），给一个稳定的次序，前后两次读才好比。
    const rows = await ex
      .select({ userId: identityGroupMembers.userId })
      .from(identityGroupMembers)
      .where(eq(identityGroupMembers.groupId, groupId))
      .orderBy(asc(identityGroupMembers.userId));
    return rows.map((row) => row.userId);
  },
  async memberCount(ex, groupId) {
    const rows = await ex
      .select({ userId: identityGroupMembers.userId })
      .from(identityGroupMembers)
      .where(eq(identityGroupMembers.groupId, groupId));
    return rows.length;
  },
  async replaceMembers(ex, groupId, userIds) {
    await ex.delete(identityGroupMembers).where(eq(identityGroupMembers.groupId, groupId));
    if (userIds.length > 0) {
      await ex.insert(identityGroupMembers).values(userIds.map((userId) => ({ groupId, userId })));
    }
  },
  async groupIdsForUser(ex, userId) {
    const rows = await ex
      .select({ groupId: identityGroupMembers.groupId })
      .from(identityGroupMembers)
      .where(eq(identityGroupMembers.userId, userId))
      .orderBy(asc(identityGroupMembers.groupId));
    return rows.map((row) => row.groupId);
  },
};

// 行数用 returning 数出来，不读驱动给的 rowCount：两种驱动对这个字段的说法不一样。
// delete 后面的 returning 不传字段、整行要回来：在两种驱动的并集上，带参数的那个重载在类型上看不见。
const sessions: SessionRepo = {
  async findByTokenHash(ex, tokenHash) {
    const rows = await ex
      .select()
      .from(identitySessions)
      .where(eq(identitySessions.tokenHash, tokenHash));
    return rows[0];
  },
  async insert(ex, row) {
    const rows = await ex.insert(identitySessions).values(row).returning();
    const inserted = rows[0];
    if (!inserted) throw new Error("会话写进去了却读不回来");
    return inserted;
  },
  async renew(ex, id, expiresAt, at) {
    await ex
      .update(identitySessions)
      .set({ expiresAt, lastSeenAt: at })
      .where(eq(identitySessions.id, id));
  },
  async rotate(ex, id, tokenHash, expiresAt, at) {
    await ex
      .update(identitySessions)
      .set({ tokenHash, expiresAt, lastSeenAt: at })
      .where(eq(identitySessions.id, id));
  },
  async delete(ex, id) {
    const rows = await ex.delete(identitySessions).where(eq(identitySessions.id, id)).returning();
    return rows.length > 0;
  },
  async deleteExpired(ex, now) {
    const rows = await ex
      .delete(identitySessions)
      .where(lte(identitySessions.expiresAt, now))
      .returning();
    return rows.length;
  },
  async deleteOthers(ex, userId, keepId) {
    const rows = await ex
      .delete(identitySessions)
      .where(and(eq(identitySessions.userId, userId), ne(identitySessions.id, keepId)))
      .returning();
    return rows.length;
  },
  async deleteAllForUser(ex, userId) {
    const rows = await ex
      .delete(identitySessions)
      .where(eq(identitySessions.userId, userId))
      .returning();
    return rows.length;
  },
};

const failures: LockoutRepo = {
  async get(ex, key) {
    const rows = await ex
      .select()
      .from(identityLoginFailures)
      .where(eq(identityLoginFailures.username, key));
    const row = rows[0];
    return row === undefined ? undefined : toFailure(row);
  },
  async lock(ex, key, at) {
    // 读完发现没有行就重来：占位行插下去、还没读出来，就可能被另一个事务删掉了
    // （同一个用户名恰好登录成功，成功会删它的失败记录）。等那个事务提交了再插一次就有了。
    // 2026-11-27 读码推演出来的，进程内的库一次只跑一个事务，复现不出来；真 Postgres 上才有。
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
      await ex
        .insert(identityLoginFailures)
        .values({ username: key, failureCount: 0, windowStartedAt: at, lockedUntil: null })
        .onConflictDoNothing({ target: identityLoginFailures.username });
      const rows = await ex
        .select()
        .from(identityLoginFailures)
        .where(eq(identityLoginFailures.username, key))
        .for("update");
      const row = rows[0];
      if (row) return toFailure(row);
    }
    throw new Error(`锁不住 ${key} 的失败记录：占位行放下去了，${LOCK_ATTEMPTS} 次都读不回来`);
  },
  async put(ex, record) {
    await ex
      .update(identityLoginFailures)
      .set({
        failureCount: record.failureCount,
        windowStartedAt: record.windowStartedAt,
        lockedUntil: record.lockedUntil,
      })
      .where(eq(identityLoginFailures.username, record.username));
  },
  async delete(ex, key) {
    await ex.delete(identityLoginFailures).where(eq(identityLoginFailures.username, key));
  },
  async prune(ex, ownKey, now) {
    // 窗口结束但还在锁的记录不删：删了锁就提前解除了。
    const stale = and(
      ne(identityLoginFailures.username, ownKey),
      lt(identityLoginFailures.windowStartedAt, new Date(now.getTime() - FAILURE_WINDOW_MS)),
      or(isNull(identityLoginFailures.lockedUntil), lte(identityLoginFailures.lockedUntil, now)),
    );
    // 先挑出来锁上，再删锁到的这几行：被别人锁着的跳过，所以两步都不用等。
    const picked = ex
      .select({ username: identityLoginFailures.username })
      .from(identityLoginFailures)
      .where(stale)
      .for("update", { skipLocked: true });
    const rows = await ex
      .delete(identityLoginFailures)
      .where(inArray(identityLoginFailures.username, picked))
      .returning();
    return rows.length;
  },
};

export function createIdentityRepo(): IdentityRepo {
  return { users, sessions, failures, groups };
}
