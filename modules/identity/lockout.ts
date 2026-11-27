/**
 * 登录锁定的规则（规格 I-12 到 I-16）。只有规则，不碰库：库的那一半在 repo.ts。
 *
 * 只有一把键：提交的用户名，转成小写。旧系统另按来源地址记一把；来源地址靠代理头带进来，可以伪造，
 * 按它计数挡不住分散的尝试，所以新版不记（规格 I-12 的来由）。
 */

/** 窗口：900 秒。失败只在窗口内计数。 */
export const FAILURE_WINDOW_MS = 900_000;
/** 窗口内错到这么多次就锁。 */
export const MAX_FAILURES = 5;
/**
 * 锁多久：900 秒，从第 5 次失败那一刻算起。
 * 不从窗口里最早一次失败算起：那样做，最短只锁 1 秒（旧系统 auth.py 的做法，台账里有测试钉着它）。
 */
export const LOCK_DURATION_MS = 900_000;

/** 一把键的失败记录。 */
export interface FailureRecord {
  /** 小写的用户名。 */
  username: string;
  failureCount: number;
  /** 这一轮窗口从哪次失败算起。 */
  windowStartedAt: Date;
  /** 锁到什么时候。为空就是没锁。 */
  lockedUntil: Date | null;
}

export function lockoutKey(username: string): string {
  return username.toLowerCase();
}

/** 还要锁多少秒；没在锁就回 undefined。向下取整，最小 1（规格 I-14）。 */
export function lockedSeconds(record: FailureRecord | undefined, now: Date): number | undefined {
  if (record?.lockedUntil === null || record?.lockedUntil === undefined) return undefined;
  const remainingMs = record.lockedUntil.getTime() - now.getTime();
  if (remainingMs <= 0) return undefined;
  return Math.max(1, Math.floor(remainingMs / 1000));
}

/**
 * 记一次失败之后的记录。调用之前已经确认过这把键没在锁。
 * 窗口已过的旧记录不接着数，从这一次重新开一轮：锁到期之后窗口一定也到期了（锁从第 5 次失败算起，
 * 不早于窗口的起点），所以「满 900 秒后再错，按新的窗口重新计数」自然成立（规格 I-13）。
 */
export function nextFailure(
  record: FailureRecord | undefined,
  key: string,
  now: Date,
): FailureRecord {
  const inWindow =
    record !== undefined && now.getTime() - record.windowStartedAt.getTime() < FAILURE_WINDOW_MS;
  const failureCount = inWindow ? record.failureCount + 1 : 1;
  const base = inWindow ? record : undefined;
  return {
    username: key,
    failureCount,
    windowStartedAt: base?.windowStartedAt ?? now,
    lockedUntil: failureCount >= MAX_FAILURES ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
  };
}
