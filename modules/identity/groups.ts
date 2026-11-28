import { isUniqueViolation, type Tx } from "@nexus/db";
import { randomUUID } from "node:crypto";
import {
  GROUP_CREATED,
  GROUP_DELETED,
  GROUP_MEMBERS_CHANGED,
  GROUP_RENAMED,
} from "./group-events.ts";
import { groupNameAccepted, normalizeGroupName } from "./names.ts";
import type { GroupRecord } from "./repo.ts";
import type { IdentityContext, RequestTrace } from "./shared.ts";

/**
 * 用户组的用例（人员规格 G-25 到 G-30，2026-11-28）：建、改名、换成员、删，外加「组在不在」的公开查询。
 * 「哪个组看得见哪些工程」不在这里——那份关系归工程模块（规格 G-31），这里对工程一无所知。
 * 写动作和事件在同一个事务里（规格 G-38）。
 */

export type GroupRejection = "name_invalid" | "name_taken" | "unknown_member";

/** 回给调用方的组形状：记录加成员编号（规格 G-01 的表，Group 五个键）。 */
export interface GroupWithMembers extends GroupRecord {
  memberIds: string[];
}

/** 组怎么回给调用方：恰好五个键，时间转成带时区的 ISO 8601（规格「路由与总则」）。 */
export function toGroup(group: GroupWithMembers) {
  return {
    id: group.id,
    name: group.name,
    memberIds: group.memberIds,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export type CreateGroupResult =
  | { kind: "ok"; group: GroupWithMembers }
  | { kind: "rejected"; reason: GroupRejection };

export type RenameGroupResult =
  | { kind: "ok"; group: GroupWithMembers }
  | { kind: "no_change"; group: GroupWithMembers }
  | { kind: "not_found" }
  | { kind: "rejected"; reason: GroupRejection };

export type ReplaceMembersResult =
  | { kind: "ok"; group: GroupWithMembers }
  | { kind: "no_change"; group: GroupWithMembers }
  | { kind: "not_found" }
  | { kind: "rejected"; reason: GroupRejection };

export type DeleteGroupResult = { kind: "ok"; memberCount: number } | { kind: "not_found" };

/** 用户组清单：创建早的在前（规格 G-01 的表），每组带上成员编号。 */
export async function listGroups(ctx: IdentityContext): Promise<GroupWithMembers[]> {
  return withMembers(ctx, await ctx.deps.repo.groups.listAll(ctx.deps.db));
}

/** 查一个组；找不到回 undefined，由处理函数回 404（规格 G-01 的表）。 */
export async function getGroup(
  ctx: IdentityContext,
  groupId: string,
): Promise<GroupWithMembers | undefined> {
  const group = await ctx.deps.repo.groups.findById(ctx.deps.db, groupId);
  if (group === undefined) return undefined;
  return (await withMembers(ctx, [group]))[0];
}

/**
 * 「这个用户组在不在」——身份模块对工程模块的唯一公开查询（规格 G-31，2026-11-28）。
 * 组合根把它接到工程模块的构造参数上；读和整体替换一个组的可见工程之前，工程模块问它。
 */
export async function groupExists(ctx: IdentityContext, groupId: string): Promise<boolean> {
  return (await ctx.deps.repo.groups.findById(ctx.deps.db, groupId)) !== undefined;
}

/**
 * 建组（规格 G-25 到 G-27）。成员必须是存在的账号，停用的也算存在；
 * 不存在的整份请求都不生效（回 400，不建组）。建组不带可见的工程（规格 G-26）。
 */
export async function createGroup(
  ctx: IdentityContext,
  input: RequestTrace & { operatorId: string; name: string; memberIds?: string[] | undefined },
): Promise<CreateGroupResult> {
  const { deps } = ctx;
  if (!groupNameAccepted(input.name)) return { kind: "rejected", reason: "name_invalid" };
  const name = normalizeGroupName(input.name);
  const memberIds = input.memberIds ?? [];
  if (await unknownMemberIds(deps, memberIds)) {
    return { kind: "rejected", reason: "unknown_member" };
  }

  // 查重不分大小写；两个只差大小写的组名同时来建，靠库里的唯一索引拦下（规格 G-25）。
  const taken = await deps.repo.groups.findByNameLower(deps.db, name.toLowerCase());
  if (taken) return { kind: "rejected", reason: "name_taken" };

  const at = ctx.now();
  const build = async (tx: Tx): Promise<GroupWithMembers> => {
    const row = await deps.repo.groups.insert(tx, {
      id: randomUUID(),
      name,
      createdAt: at,
      updatedAt: at,
    });
    if (memberIds.length > 0) await deps.repo.groups.replaceMembers(tx, row.id, memberIds);
    await ctx.emit(
      tx,
      GROUP_CREATED,
      row.id,
      { groupId: row.id, actorId: input.operatorId, name },
      input.traceId,
    );
    return { ...row, memberIds: [...memberIds] };
  };
  try {
    return { kind: "ok", group: await deps.db.transaction(build) };
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "rejected", reason: "name_taken" };
    throw err;
  }
}

/**
 * 改组名（规格 G-29）。名字没变回 200 不写不发；变了写库、更新更新时间、发事件，成员不动。
 */
export async function renameGroup(
  ctx: IdentityContext,
  input: RequestTrace & { operatorId: string; groupId: string; name: string },
): Promise<RenameGroupResult> {
  const { deps } = ctx;
  if (!groupNameAccepted(input.name)) return { kind: "rejected", reason: "name_invalid" };
  const name = normalizeGroupName(input.name);
  const group = await deps.repo.groups.findById(deps.db, input.groupId);
  if (!group) return { kind: "not_found" };
  const members = await deps.repo.groups.memberIds(deps.db, group.id);
  if (name === group.name) return { kind: "no_change", group: { ...group, memberIds: members } };

  const at = ctx.now();
  try {
    const updated = await deps.db.transaction(async (tx): Promise<GroupWithMembers> => {
      await deps.repo.groups.rename(tx, group.id, name, at);
      await ctx.emit(
        tx,
        GROUP_RENAMED,
        group.id,
        {
          groupId: group.id,
          actorId: input.operatorId,
          changes: { name: { from: group.name, to: name } },
        },
        input.traceId,
      );
      return { ...group, name, updatedAt: at, memberIds: members };
    });
    return { kind: "ok", group: updated };
  } catch (err) {
    // 撞上库里 lower(name) 的唯一索引：两个只差大小写的组名并发改（规格 G-25）。
    if (isUniqueViolation(err)) return { kind: "rejected", reason: "name_taken" };
    throw err;
  }
}

/**
 * 整体替换成员（规格 G-27、G-28）。集合和原来一样（不看顺序）回 200 不写不发；
 * 不存在的账号编号整份请求都不生效。
 */
export async function replaceGroupMembers(
  ctx: IdentityContext,
  input: RequestTrace & { operatorId: string; groupId: string; userIds: string[] },
): Promise<ReplaceMembersResult> {
  const { deps } = ctx;
  const group = await deps.repo.groups.findById(deps.db, input.groupId);
  if (!group) return { kind: "not_found" };
  if (await unknownMemberIds(deps, input.userIds)) {
    return { kind: "rejected", reason: "unknown_member" };
  }

  const before = await deps.repo.groups.memberIds(deps.db, group.id);
  if (sameSet(before, input.userIds)) {
    return { kind: "no_change", group: { ...group, memberIds: before } };
  }

  const at = ctx.now();
  const updated = await deps.db.transaction(async (tx): Promise<GroupWithMembers> => {
    await deps.repo.groups.replaceMembers(tx, group.id, input.userIds);
    await ctx.emit(
      tx,
      GROUP_MEMBERS_CHANGED,
      group.id,
      {
        groupId: group.id,
        actorId: input.operatorId,
        changes: { members: { from: before, to: input.userIds } },
      },
      input.traceId,
    );
    return { ...group, updatedAt: at, memberIds: [...input.userIds] };
  });
  return { kind: "ok", group: updated };
}

/**
 * 删组（规格 G-30）。不要求是空的；不删账号，也不删工程。工程模块关系表里的行随外键一起删，
 * 没有工程模块的代码参与，也不发工程的事件（规格 G-39）。
 */
export async function deleteGroup(
  ctx: IdentityContext,
  input: RequestTrace & { operatorId: string; groupId: string },
): Promise<DeleteGroupResult> {
  const { deps } = ctx;
  const group = await deps.repo.groups.findById(deps.db, input.groupId);
  if (!group) return { kind: "not_found" };

  const memberCount = await deps.db.transaction(async (tx) => {
    const count = await deps.repo.groups.memberCount(tx, group.id);
    await deps.repo.groups.delete(tx, group.id);
    await ctx.emit(
      tx,
      GROUP_DELETED,
      group.id,
      { groupId: group.id, actorId: input.operatorId, name: group.name, memberCount: count },
      input.traceId,
    );
    return count;
  });
  return { kind: "ok", memberCount };
}

/** 这些编号里有没有账号表里不存在的（停用的也算存在，规格 G-27）。 */
async function unknownMemberIds(deps: IdentityContext["deps"], ids: string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  const existing = new Set(await deps.repo.users.existingIds(deps.db, ids));
  return ids.some((id) => !existing.has(id));
}

/** 记录上没有成员编号（成员关系在另一张表），回给调用方之前补上。 */
async function withMembers(
  ctx: IdentityContext,
  groups: GroupRecord[],
): Promise<GroupWithMembers[]> {
  return Promise.all(
    groups.map(async (group) => ({
      ...group,
      memberIds: await ctx.deps.repo.groups.memberIds(ctx.deps.db, group.id),
    })),
  );
}

/** 两个集合一样（不看顺序，规格 G-28）。 */
function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}
