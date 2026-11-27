// 全机器一把锁：同一台机器上一次只跑一路重闸（L2、L3）。
//
// 2026-11-27 实弹：三个代理在各自的工作区里同时跑闸，8 个逻辑核打到 100%，集成测试一批批死在
// 「准备阶段 10 秒超时」（HookTimeoutError）上。那是假红，代理却会当成缺陷去追。重闸本来就吃满处理器，
// 并排跑不会更快，只会互相拖垮，所以让它排队：后到的等先到的跑完。
//
// 锁是一个用独占方式创建的文件，放在系统临时目录下，所以同一台机器上的所有工作区共用一把。
// 文件里记着持有者：进程号、哪一道闸、在哪个目录、什么时候开始的。持有者跑的时候定时给文件续命；
// 文件太久没续命、或者那个进程已经不在了，就当持有者死了，接管。
import { randomUUID } from "node:crypto";
import { open, readFile, stat, unlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LockOptions {
  /** 锁文件在哪。缺省在系统临时目录下。 */
  path?: string;
  /** 最多等多久，毫秒。缺省 15 分钟：一路重闸再慢也用不了这么久。 */
  maxWaitMs?: number;
  /** 隔多久再看一次，毫秒。缺省 2 秒。 */
  pollMs?: number;
  /** 锁文件多久没被续命就当持有者死了，毫秒。缺省 2 分钟（持有者每 20 秒续一次命）。 */
  staleMs?: number;
  /** 往哪写进度。缺省标准输出。 */
  log?: (line: string) => void;
  /** 某个进程还活着吗。测试换掉。 */
  isAlive?: (pid: number) => boolean;
}

interface Holder {
  token: string;
  pid: number;
  level: string;
  cwd: string;
  startedAt: number;
}

export const DEFAULT_LOCK_PATH = join(tmpdir(), "nexus-heavy-gate.lock");
const REFRESH_MS = 20_000;

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // 信号 0 只做存在性检查，不发任何东西。
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readHolder(path: string): Promise<Holder | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const h = parsed as Partial<Holder>;
    if (typeof h.token !== "string" || typeof h.pid !== "number" || typeof h.level !== "string")
      return undefined;
    return {
      token: h.token,
      pid: h.pid,
      level: h.level,
      cwd: typeof h.cwd === "string" ? h.cwd : "",
      startedAt: typeof h.startedAt === "number" ? h.startedAt : 0,
    };
  } catch {
    return undefined;
  }
}

async function tryAcquire(path: string, holder: Holder): Promise<boolean> {
  try {
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(holder)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    // 已经有人在拿着。别的错（目录不在、没权限）也当成拿不到，由调用方按超时报出来，不吞成成功。
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    return false;
  }
}

/** 锁文件最后被碰过的时间。读不到就当很旧。 */
async function lastTouched(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 拿到锁再跑 body，跑完放开。别的重闸在跑就等，等到上限就抛错。
 * 等待的时间不算在调用方自己的步骤里：拿锁发生在第一步之前。
 */
export async function withHeavyGateLock<T>(
  level: string,
  body: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const path = options.path ?? DEFAULT_LOCK_PATH;
  const maxWaitMs = options.maxWaitMs ?? 15 * 60_000;
  const pollMs = options.pollMs ?? 2_000;
  const staleMs = options.staleMs ?? 2 * 60_000;
  const log = options.log ?? ((line: string) => console.log(line));
  const isAlive = options.isAlive ?? alive;
  const holder: Holder = {
    token: randomUUID(),
    pid: process.pid,
    level,
    cwd: process.cwd(),
    startedAt: Date.now(),
  };

  const waitStarted = Date.now();
  let announced = false;
  for (;;) {
    if (await tryAcquire(path, holder)) break;
    const current = await readHolder(path);
    const touch = await lastTouched(path);
    const gone = current === undefined || !isAlive(current.pid) || Date.now() - touch > staleMs;
    if (gone) {
      // 持有者死了，或者文件不是一把锁：清掉再来。几个等待者同时清，只有一个清得掉，只有一个抢得到。
      await unlink(path).catch(() => undefined);
      continue;
    }
    if (Date.now() - waitStarted >= maxWaitMs) {
      throw new Error(
        `另一路重闸还在跑，等了 ${Math.round(maxWaitMs / 1000)} 秒没有等到：${current.level}（进程 ${current.pid}，${current.cwd || "目录不明"}）。`,
      );
    }
    if (!announced) {
      log(
        `   等另一路重闸跑完：${current.level}（进程 ${current.pid}，${current.cwd || "目录不明"}）……`,
      );
      announced = true;
    }
    await sleep(pollMs);
  }
  if (announced) log(`   轮到本路，等了 ${Math.round((Date.now() - waitStarted) / 1000)} 秒`);

  const refresh = setInterval(() => {
    utimes(path, new Date(), new Date()).catch(() => undefined);
  }, REFRESH_MS);
  refresh.unref();
  try {
    return await body();
  } finally {
    clearInterval(refresh);
    // 只放开自己的锁：万一文件已经被别人接管，不动它。
    const mine = await readHolder(path);
    if (mine?.token === holder.token) await unlink(path).catch(() => undefined);
  }
}
