import type { DatabaseHandle, Db, Executor } from "@nexus/db";
import { createIdentityRepo } from "@nexus/identity";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH,
  T0,
  boot,
  call,
  clearIdentity,
  createTestDatabase,
  failureRows,
  seedUser,
} from "./testing/kit.ts";

/**
 * 失败记录的仓储在真库上的样子（规格 I-12「每次记的时候顺手删掉全表窗口外的记录」）。
 * 单元测试用的是内存替身，这里的 SQL 此前没有任何断言打过：窗口怎么算、哪些行留着，只有真库说了算。
 *
 * 真正的并发在进程内的库上复现不出来，它一次只跑一个事务。「占位行被别的事务抢先删掉」是造出来的交错；
 * 「两个请求同时记同一个用户名不丢数」「扫全表不和别的请求互相等死」没法造，那两条是读码推演，来由写在模块的 repo.ts 里。
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

const NOW = T0;
const MINUTE = 60_000;
const failures = createIdentityRepo().failures;
type FailureRecord = Awaited<ReturnType<typeof failures.lock>>;

/** 放一行失败记录：先放占位，再改成要的样子。 */
async function putFailure(username: string, record: Partial<FailureRecord>): Promise<void> {
  const base = await failures.lock(database.db, username, NOW);
  await failures.put(database.db, { ...base, ...record });
}

const usernames = async (): Promise<string[]> =>
  (await failureRows(database.db)).map((row) => row.username);

describe("lock：占位加行锁", () => {
  it("没有记录就放一行计数为 0 的占位，读回来的就是它", async () => {
    const record = await failures.lock(database.db, "newbie", NOW);
    expect(record).toEqual({
      username: "newbie",
      failureCount: 0,
      windowStartedAt: NOW,
      lockedUntil: null,
    });
    expect(await failures.get(database.db, "newbie")).toEqual(record);
  });

  it("已经有记录：占位不覆盖它，读回来的是原来的", async () => {
    const startedAt = new Date(NOW.getTime() - MINUTE);
    await putFailure("carol", { failureCount: 3, windowStartedAt: startedAt });
    const record = await failures.lock(database.db, "carol", NOW);
    expect(record).toEqual({
      username: "carol",
      failureCount: 3,
      windowStartedAt: startedAt,
      lockedUntil: null,
    });
  });

  it("在事务里「锁、加一、写」两回，计数是 2，不是两回各写的 1", async () => {
    for (let i = 0; i < 2; i++) {
      await database.db.transaction(async (tx) => {
        const current = await failures.lock(tx, "dave", NOW);
        await failures.put(tx, { ...current, failureCount: current.failureCount + 1 });
      });
    }
    expect(await failureRows(database.db)).toEqual([
      expect.objectContaining({ username: "dave", failure_count: 2 }),
    ]);
  });

  it("删掉之后再锁，是一行新的计数为 0 的记录", async () => {
    await putFailure("erin", { failureCount: 4 });
    await failures.delete(database.db, "erin");
    expect(await failures.get(database.db, "erin")).toBeUndefined();
    expect(await failures.lock(database.db, "erin", NOW)).toMatchObject({
      failureCount: 0,
      lockedUntil: null,
    });
  });

  it("占位行插下去、还没读出来，就被另一个事务删了：重来一次，照样锁得住，不抛", async () => {
    // 真库上会有这种交错：同一个用户名一边登录失败、一边登录成功，成功的那边删掉了失败记录
    let placeholders = 0;
    const racing = racingExecutor(database.db, async () => {
      placeholders += 1;
      if (placeholders === 1) await failures.delete(database.db, "flip");
    });
    expect(await failures.lock(racing, "flip", NOW)).toMatchObject({ failureCount: 0 });
    // 第一回的占位行被删了，第二回的留住了
    expect(placeholders).toBe(2);
    expect(await usernames()).toEqual(["flip"]);
  });
});

/**
 * 一个「别的请求插了一脚」的执行者：占位行真的写进去之后，多做一件事。
 * 只拦 lock 用到的那一句（insert … on conflict do nothing），别的照常交给真库。
 */
function racingExecutor(db: Db, afterPlaceholder: () => Promise<void>): Executor {
  return new Proxy(db, {
    get(target, property) {
      if (property === "select") return target.select.bind(target);
      if (property !== "insert") return Reflect.get(target, property, target);
      return (table: never) => {
        const builder = target.insert(table);
        // 原来的方法先攥在手里：下面要往同一个对象上盖同名的方法，盖完再从它身上取就是自己调自己
        const addValues = builder.values.bind(builder);
        return Object.assign(builder, {
          values: (row: never) => {
            const withValues = addValues(row);
            const addConflict = withValues.onConflictDoNothing.bind(withValues);
            return Object.assign(withValues, {
              onConflictDoNothing: (config: never) =>
                Promise.resolve(addConflict(config)).then(async (result) => {
                  await afterPlaceholder();
                  return result;
                }),
            });
          },
        });
      };
    },
  }) as Executor;
}

describe("prune：顺手删掉全表窗口外的记录（规格 I-12）", () => {
  it("窗口结束又不在锁的删掉；还在窗口里的、还在锁的留着；自己那一行不碰；回删掉的行数", async () => {
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 60 * MINUTE);
    await putFailure("stale-open", { windowStartedAt: twoHoursAgo });
    await putFailure("stale-unlocked", {
      windowStartedAt: twoHoursAgo,
      lockedUntil: new Date(NOW.getTime() - MINUTE),
    });
    await putFailure("fresh", { windowStartedAt: new Date(NOW.getTime() - 10 * MINUTE) });
    await putFailure("still-locked", {
      windowStartedAt: twoHoursAgo,
      lockedUntil: new Date(NOW.getTime() + MINUTE),
    });
    await putFailure("self", { windowStartedAt: twoHoursAgo });

    expect(await failures.prune(database.db, "self", NOW)).toBe(2);
    expect(await usernames()).toEqual(["fresh", "self", "still-locked"]);

    // 换一把键再来一回：self 这回是别人了，照样删
    expect(await failures.prune(database.db, "other", NOW)).toBe(1);
    expect(await usernames()).toEqual(["fresh", "still-locked"]);
  });

  it("窗口是 15 分钟，边界是「早于窗口的起点」才删", async () => {
    const windowStart = new Date(NOW.getTime() - 15 * MINUTE);
    await putFailure("edge", { windowStartedAt: windowStart });
    await putFailure("just-before", { windowStartedAt: new Date(windowStart.getTime() - 1) });
    expect(await failures.prune(database.db, "whoever", NOW)).toBe(1);
    expect(await usernames()).toEqual(["edge"]);
  });

  it("没有可删的回 0", async () => {
    expect(await failures.prune(database.db, "whoever", NOW)).toBe(0);
    await putFailure("fresh", { windowStartedAt: new Date(NOW.getTime() - MINUTE) });
    expect(await failures.prune(database.db, "whoever", NOW)).toBe(0);
  });
});

describe("走真路由记一次失败，全表窗口外的记录跟着消失", () => {
  it("登录失败之后：别的用户名留在窗口外的记录没有了，还在锁的还在", async () => {
    const api = await boot({ db: database.db });
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 60 * MINUTE);
    await putFailure("old", { windowStartedAt: twoHoursAgo, failureCount: 1 });
    await putFailure("held", {
      windowStartedAt: twoHoursAgo,
      failureCount: 5,
      lockedUntil: new Date(NOW.getTime() + MINUTE),
    });
    await seedUser(database.db, { username: "alice", password: "alice-password-1" });

    const reply = await call(api.app, AUTH.login, {
      method: "POST",
      body: { username: "alice", password: "wrong-password" },
    });
    expect(reply.status).toBe(401);
    expect(await usernames()).toEqual(["alice", "held"]);
  });
});
