// 重闸互斥的测试。用 Node 自带的测试器，不为工具层再引一个测试框架：`node --test "tools/gates/*.test.ts"`。
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withHeavyGateLock } from "./lock.ts";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 每个用例一把自己的锁，放在临时目录里，不碰真正的锁文件。 */
async function freshLock(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "nexus-lock-test-")), "gate.lock");
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** 等到条件成立，最多 2 秒。 */
async function waitUntil(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("等了 2 秒条件还没成立");
    await sleep(5);
  }
}

const fast = { pollMs: 10, log: () => undefined };

test("拿到锁、跑完放开：返回结果，锁文件不在了", async () => {
  const path = await freshLock();
  const result = await withHeavyGateLock("L2", async () => 42, { path, ...fast });
  assert.equal(result, 42);
  assert.equal(await exists(path), false);
});

test("后到的等先到的：第二路在第一路放开之后才开始，并且说了一声在等", async () => {
  const path = await freshLock();
  const events: string[] = [];
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withHeavyGateLock(
    "L2",
    async () => {
      events.push("甲开始");
      await held;
      events.push("甲结束");
    },
    { path, ...fast },
  );
  await waitUntil(() => exists(path));

  const lines: string[] = [];
  const second = withHeavyGateLock(
    "L3",
    async () => {
      events.push("乙开始");
    },
    { path, pollMs: 10, log: (line) => lines.push(line) },
  );
  await sleep(80);
  assert.deepEqual(events, ["甲开始"], "甲还拿着锁，乙不该开始");
  assert.ok(
    lines.some((line) => line.includes("等另一路重闸") && line.includes("L2")),
    lines.join("\n"),
  );

  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["甲开始", "甲结束", "乙开始"]);
  assert.ok(
    lines.some((line) => line.includes("轮到本路")),
    lines.join("\n"),
  );
  assert.equal(await exists(path), false);
});

test("持有者的进程已经不在了：接管，不等", async () => {
  const path = await freshLock();
  await writeFile(
    path,
    `${JSON.stringify({ token: "死人的", pid: 2147483646, level: "L2", cwd: "别处", startedAt: Date.now() })}\n`,
  );
  const result = await withHeavyGateLock("L3", async () => "接管了", {
    path,
    ...fast,
    isAlive: () => false,
  });
  assert.equal(result, "接管了");
  assert.equal(await exists(path), false);
});

test("锁文件太久没被续命：当持有者死了", async () => {
  const path = await freshLock();
  await writeFile(
    path,
    `${JSON.stringify({ token: "很久以前的", pid: process.pid, level: "L2", cwd: "", startedAt: 0 })}\n`,
  );
  const longAgo = new Date(Date.now() - 10 * 60_000);
  await utimes(path, longAgo, longAgo);
  const result = await withHeavyGateLock("L3", async () => "接管了", {
    path,
    ...fast,
    staleMs: 60_000,
    isAlive: () => true,
  });
  assert.equal(result, "接管了");
});

test("文件里不是一把锁：清掉重来", async () => {
  const path = await freshLock();
  await writeFile(path, "不是 JSON");
  const result = await withHeavyGateLock("L2", async () => "跑到了", { path, ...fast });
  assert.equal(result, "跑到了");
});

test("等到上限还没轮到：报出是谁在占着，不跑正文", async () => {
  const path = await freshLock();
  await writeFile(
    path,
    `${JSON.stringify({ token: "别人的", pid: 1234, level: "L3", cwd: "某个目录", startedAt: Date.now() })}\n`,
  );
  let ran = false;
  await assert.rejects(
    withHeavyGateLock(
      "L2",
      async () => {
        ran = true;
      },
      { path, pollMs: 10, maxWaitMs: 40, isAlive: () => true, log: () => undefined },
    ),
    /另一路重闸还在跑.*L3.*进程 1234.*某个目录/,
  );
  assert.equal(ran, false);
  assert.equal(
    JSON.parse(await readFile(path, "utf8")).token,
    "别人的",
    "别人的锁不能被等的人清掉",
  );
});

test("只放开自己的锁：正文跑完时锁已经被别人接管，就留着别人的", async () => {
  const path = await freshLock();
  await withHeavyGateLock(
    "L2",
    async () => {
      await writeFile(
        path,
        `${JSON.stringify({ token: "接管者的", pid: 4321, level: "L3", cwd: "", startedAt: Date.now() })}\n`,
      );
    },
    { path, ...fast },
  );
  assert.equal(JSON.parse(await readFile(path, "utf8")).token, "接管者的");
});

test.after(async () => {
  // 用例各自建的临时目录：按前缀找回来，删得掉就删，删不掉也不算失败。
  const { readdir } = await import("node:fs/promises");
  for (const name of await readdir(tmpdir())) {
    if (name.startsWith("nexus-lock-test-"))
      await rm(join(tmpdir(), name), { recursive: true, force: true }).catch(() => undefined);
  }
});
