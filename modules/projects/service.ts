import { PROJECT_UPDATED, type ProjectUpdatedChanges } from "./events.ts";
import { create } from "./create.ts";
import {
  listGroupProjects,
  setGroupProjects,
  type GroupProjectsResult,
} from "./group-visibility.ts";
import { normalizeAvatar, normalizeDisplayName } from "./names.ts";
import type { ProjectRecord } from "./repo.ts";
import { readHead } from "./repository.ts";
import {
  createProjectsContext,
  type Caller,
  type CreateProjectInput,
  type CreateProjectResult,
  type ProjectDetail,
  type ProjectsContext,
  type ProjectsServiceDeps,
  type UpdateProjectInput,
  type UpdateProjectResult,
} from "./shared.ts";

/**
 * 工程模块的用例：清单、详情、改显示名和头像字在这里，新建在 create.ts，
 * 一个组的可见工程在 group-visibility.ts。业务规则只住在这三个文件里。
 * 这一行到 300 行是上限，超了就拆，不调限额（任务书 P11）。
 */

export interface ProjectsService {
  /** 看得见的工程，新的在前。只读库，不跑 git，不碰仓库目录（规格 P-08、P-09）。 */
  list(caller: Caller): Promise<ProjectRecord[]>;
  create(
    caller: Caller,
    input: CreateProjectInput,
    traceId?: string | undefined,
  ): Promise<CreateProjectResult>;
  /**
   * 看不见和不存在是同一个回应（规格 P-11）。跑一次 git 读最新提交（规格 P-25）；
   * 读不到就抛，不回一个 `head` 为空的详情（规格 P-26）。
   */
  get(caller: Caller, id: string): Promise<ProjectDetail | undefined>;
  update(
    caller: Caller,
    id: string,
    input: UpdateProjectInput,
    traceId?: string | undefined,
  ): Promise<UpdateProjectResult>;
  /** 一个组看得见的工程：读（规格 G-01 的表）。组不存在回 not_found。 */
  listGroupProjects(groupId: string): Promise<GroupProjectsResult>;
  /** 一个组看得见的工程：整体替换（规格 G-28）。actorId 是操作者的账号编号。 */
  setGroupProjects(
    actorId: string,
    groupId: string,
    projectIds: string[],
    traceId?: string | undefined,
  ): Promise<GroupProjectsResult>;
}

export function createProjectsService(deps: ProjectsServiceDeps): ProjectsService {
  const ctx = createProjectsContext(deps);
  return {
    list: (caller) => list(ctx, caller),
    create: (caller, input, traceId) => create(ctx, caller, input, traceId),
    get: (caller, id) => get(ctx, caller, id),
    update: (caller, id, input, traceId) => update(ctx, caller, id, input, traceId),
    listGroupProjects: (groupId) => listGroupProjects(ctx, groupId),
    setGroupProjects: (actorId, groupId, projectIds, traceId) =>
      setGroupProjects(ctx, actorId, groupId, projectIds, traceId),
  };
}

async function list(ctx: ProjectsContext, caller: Caller): Promise<ProjectRecord[]> {
  const { deps } = ctx;
  // 清单不跑 git：旧系统每个工程跑 3 到 4 次，页面每 5 秒重取一次（规格 P-09 的来源）。
  // 可见性交出范围，仓储照它在库里过滤（规格 G-32）。
  return deps.repo.listVisible(deps.db, deps.canSee(caller));
}

async function get(
  ctx: ProjectsContext,
  caller: Caller,
  id: string,
): Promise<ProjectDetail | undefined> {
  const { deps } = ctx;
  // 看不见和不存在回得一样，由处理函数回同一个 404（规格 P-11）。
  const record = await deps.repo.visibleById(deps.db, id, deps.canSee(caller));
  if (record === undefined) return undefined;
  const head = await readHead({ root: deps.root, id, git: deps.git });
  return { project: record, head };
}

/** 改显示名和头像字（规格 P-29 到 P-33）。查的顺序：看不看得见、能不能改、有没有变。 */
async function update(
  ctx: ProjectsContext,
  caller: Caller,
  id: string,
  input: UpdateProjectInput,
  traceId: string | undefined,
): Promise<UpdateProjectResult> {
  const { deps } = ctx;
  const record = await deps.repo.visibleById(deps.db, id, deps.canSee(caller));
  if (record === undefined) return { kind: "not_found" };
  // 只有创建者和管理员能改；看得见但不属这两种的回 403（规格 P-29）。
  if (record.createdById !== caller.id && !caller.isAdmin) return { kind: "forbidden" };

  const displayName =
    input.displayName === undefined ? record.displayName : normalizeDisplayName(input.displayName);
  const avatar = input.avatar === undefined ? record.avatar : normalizeAvatar(input.avatar);
  const changes = changesOf(record, { displayName, avatar });
  // 没变就不动：不更新更新时间，不发事件（规格 P-31）。
  if (changes === undefined) return { kind: "ok", project: record };

  const at = ctx.now();
  const project = await deps.db.transaction(async (tx) => {
    await deps.repo.updateProfile(tx, id, { displayName, avatar }, at);
    await ctx.emit(
      tx,
      PROJECT_UPDATED,
      id,
      { projectId: id, slug: record.slug, actorId: caller.id, changes },
      traceId,
    );
    return { ...record, displayName, avatar, updatedAt: at };
  });
  return { kind: "ok", project };
}

/** 真变了的键，每个带 from 和 to；一个都没变回 undefined（规格事件表、P-31）。 */
function changesOf(
  record: ProjectRecord,
  next: { displayName: string; avatar: string },
): ProjectUpdatedChanges | undefined {
  const changes: ProjectUpdatedChanges = {};
  if (next.displayName !== record.displayName) {
    changes.displayName = { from: record.displayName, to: next.displayName };
  }
  if (next.avatar !== record.avatar) changes.avatar = { from: record.avatar, to: next.avatar };
  return changes.displayName === undefined && changes.avatar === undefined ? undefined : changes;
}
