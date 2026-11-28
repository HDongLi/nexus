import { z } from "zod";

/**
 * 用户组的四个事件（人员规格的事件表，2026-11-28）。账号与登录的事件在 events.ts。
 * subject 一律是组编号：路径里的 `groupId` 用的也是它，组的名字以后可能允许改。
 * payload 的键只有下面列的这些，不许出现口令、散列、盐（规格 G-37）。
 */

/** 建组。 */
export const GROUP_CREATED = "identity.group.created" as const;
/** 组名真的变了（规格 G-29）。 */
export const GROUP_RENAMED = "identity.group.renamed" as const;
/** 成员真的变了（规格 G-28）。 */
export const GROUP_MEMBERS_CHANGED = "identity.group.members.changed" as const;
/** 删组（规格 G-30）。 */
export const GROUP_DELETED = "identity.group.deleted" as const;

const groupId = z.string().uuid();
const actorId = z.string().uuid();

/** 成员和可见工程的 from、to 是编号的数组，按原样全量记，不记差集（规格事件表）。 */
const idList = z.array(z.string().uuid());

export const groupCreatedPayload = z.strictObject({ groupId, actorId, name: z.string().min(1) });

/** changes 只列真变了的键；一个都没有的事件是写错了，形状上就过不去。 */
export const groupRenamedPayload = z.strictObject({
  groupId,
  actorId,
  changes: z.strictObject({ name: z.strictObject({ from: z.string(), to: z.string() }) }),
});

export const groupMembersChangedPayload = z.strictObject({
  groupId,
  actorId,
  changes: z.strictObject({ members: z.strictObject({ from: idList, to: idList }) }),
});

/** memberCount：删之前组里有几个人（规格事件表）。它当初看得见哪些工程不记：那是工程模块的关系表。 */
export const groupDeletedPayload = z.strictObject({
  groupId,
  actorId,
  name: z.string().min(1),
  memberCount: z.number().int().min(0),
});

export type GroupCreatedPayload = z.output<typeof groupCreatedPayload>;
export type GroupRenamedPayload = z.output<typeof groupRenamedPayload>;
export type GroupMembersChangedPayload = z.output<typeof groupMembersChangedPayload>;
export type GroupDeletedPayload = z.output<typeof groupDeletedPayload>;
