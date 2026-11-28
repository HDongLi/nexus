import { z } from "zod";
import { SLUG_PATTERN } from "./slug.ts";

/**
 * 工程模块发出的两个事件（规格的事件表）。名字带三层：模块.对象.动作。
 * subject 一律是工程编号：路径里的 `projectId` 用的也是它（规格「术语」）。
 * payload 里不许出现服务器上的路径（规格 P-35），所以只放编号、短名和操作者。
 */

/** 工程建成：仓库已可用，记录已落下。 */
export const PROJECT_CREATED = "projects.project.created" as const;
/** 显示名或头像字真的变了。没变的请求不发（规格 P-31）。 */
export const PROJECT_UPDATED = "projects.project.updated" as const;

const id = z.string().uuid();
const slug = z.string().regex(SLUG_PATTERN);

/**
 * actorId 是调用者的账号编号。事件的主体是工程，不带操作者，事后就查不出是谁改的，
 * 所以每个由人触发的写事件都带上它（编排者 2026-11-27 采纳）。
 */
const actor = { projectId: id, slug, actorId: id };

export const projectCreatedPayload = z.strictObject({ ...actor });

/** 一处改动的前后两个值。 */
const change = z.strictObject({ from: z.string(), to: z.string() });

/** changes 只列真变了的键，每个键带 from 和 to；一个都没有的事件是写错了，形状上就过不去。 */
export const projectUpdatedPayload = z.strictObject({
  ...actor,
  changes: z
    .strictObject({ displayName: change.optional(), avatar: change.optional() })
    .refine(
      (changes) => changes.displayName !== undefined || changes.avatar !== undefined,
      "changes 里至少要有一处改动",
    ),
});

export type ProjectUpdatedChanges = {
  displayName?: { from: string; to: string };
  avatar?: { from: string; to: string };
};
export type ProjectCreatedPayload = z.output<typeof projectCreatedPayload>;
export type ProjectUpdatedPayload = z.output<typeof projectUpdatedPayload>;
