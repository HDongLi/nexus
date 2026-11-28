import type { IdentityRepo, UserRecord } from "./repo.ts";

/**
 * 护栏的帮手（规格 G-18 到 G-20，2026-11-28）。三个动作（降级、停用、删号）共用一道闸：
 * 「这次改动会不会让系统没有启用的管理员」。「不动自己」更简单，也是同一个文件。
 * 都在写库之前查；数管理员那一步在写库的事务里做（规格 G-20）。
 */

/** 「自己」按账号编号判：路径里的编号等于操作者的编号（规格 G-19）。 */
export function isSelf(operatorId: string, targetId: string): boolean {
  return operatorId === targetId;
}

/**
 * 这次改动会不会把最后一个启用的管理员动掉。
 * 调用方必须已经开着写库的事务：这里先 `SELECT … FOR UPDATE` 锁住全部启用的管理员行再数（规格 G-20），
 * 两个管理员并发互相降级时，后到的等前一个提交，再数就不是 1 了。目标不是启用的管理员时，
 * 这次改动不减管理员数，不用锁、也不用数。
 */
export async function wouldLoseLastAdmin(
  repo: IdentityRepo,
  ex: Parameters<IdentityRepo["users"]["lockEnabledAdmins"]>[0],
  target: Pick<UserRecord, "isAdmin" | "disabledAt">,
): Promise<boolean> {
  if (!target.isAdmin || target.disabledAt !== null) return false;
  return (await repo.users.lockEnabledAdmins(ex)) <= 1;
}
