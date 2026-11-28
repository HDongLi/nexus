import { VISIBILITY_CHANGED } from "./events.ts";
import type { ProjectsContext } from "./shared.ts";

/**
 * 一个组的可见工程（人员规格 G-27、G-28、G-31，2026-11-28）。关系表是这个模块的，
 * 组本身不是：动之前先问身份模块「组在不在」（构造参数里的公开查询），不在回 404。
 * 写动作和事件在同一个事务里（规格 G-38）。
 */

export type GroupProjectsResult =
  | { kind: "ok"; projectIds: string[] }
  | { kind: "not_found" }
  | { kind: "no_change"; projectIds: string[] }
  /** 请求里有不存在的工程编号（规格 G-27）。 */
  | { kind: "unknown_project" };

/** 读一个组看得见的工程（规格 G-01 的表）。组不在也回 404。 */
export async function listGroupProjects(
  ctx: ProjectsContext,
  groupId: string,
): Promise<GroupProjectsResult> {
  const { deps } = ctx;
  if (!(await deps.groupExists(groupId))) return { kind: "not_found" };
  return { kind: "ok", projectIds: await deps.repo.projectIdsForGroup(deps.db, groupId) };
}

/**
 * 整体替换一个组看得见的工程（规格 G-28）。先问「组在不在」，再查工程编号都存在
 * （不存在的整份请求都不生效，规格 G-27），然后删再插；和原来一样（不看顺序）回 200 不写不发。
 */
export async function setGroupProjects(
  ctx: ProjectsContext,
  actorId: string,
  groupId: string,
  projectIds: string[],
  traceId: string | undefined,
): Promise<GroupProjectsResult> {
  const { deps } = ctx;
  if (!(await deps.groupExists(groupId))) return { kind: "not_found" };
  const existing = new Set(await deps.repo.existingIds(deps.db, projectIds));
  if (projectIds.some((id) => !existing.has(id))) return { kind: "unknown_project" };

  const before = await deps.repo.projectIdsForGroup(deps.db, groupId);
  if (sameSet(before, projectIds)) return { kind: "no_change", projectIds: before };

  const updated = await deps.db.transaction(async (tx) => {
    await deps.repo.replaceProjectsForGroup(tx, groupId, projectIds);
    await ctx.emit(
      tx,
      VISIBILITY_CHANGED,
      groupId,
      {
        groupId,
        actorId,
        changes: { projectIds: { from: before, to: projectIds } },
        cause: "admin",
      },
      traceId,
    );
    return projectIds;
  });
  return { kind: "ok", projectIds: updated };
}

/** 两个集合一样（不看顺序，规格 G-28）。 */
function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}
