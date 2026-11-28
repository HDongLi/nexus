import { randomUUID } from "node:crypto";
import { PROJECT_CREATED } from "./events.ts";
import { projectTitle } from "./initial-files.ts";
import { normalizeAvatar, normalizeDisplayName } from "./names.ts";
import type { NewProject } from "./repo.ts";
import { buildRepository } from "./repository.ts";
import {
  isUniqueViolation,
  type Caller,
  type CreateProjectInput,
  type CreateProjectResult,
  type ProjectsContext,
} from "./shared.ts";

/**
 * 新建（设计 02「建仓」）：校验在路由那一层；这里先查短名、建仓库，再开事务写记录、发事件。
 * 任何一步失败都回到什么都没发生过（规格 P-20）。
 */
export async function create(
  ctx: ProjectsContext,
  caller: Caller,
  input: CreateProjectInput,
  traceId: string | undefined,
): Promise<CreateProjectResult> {
  const { deps } = ctx;
  // 先查一遍短名，占了就直接回、不跑 git。这一步只是省事，真正的保证是库里的唯一约束（规格 P-15、P-21）。
  if (await deps.repo.findBySlug(deps.db, input.slug)) return { kind: "slug_taken" };

  const id = randomUUID();
  const displayName = normalizeDisplayName(input.displayName ?? "");
  const avatar = normalizeAvatar(input.avatar ?? "");
  try {
    await buildRepository({
      root: deps.root,
      id,
      git: deps.git,
      title: projectTitle({ slug: input.slug, displayName }),
    });
  } catch (err) {
    ctx.report("建仓库", id, traceId, err);
    return { kind: "failed" };
  }

  const at = ctx.now();
  const row: NewProject = {
    id,
    slug: input.slug,
    displayName,
    avatar,
    createdById: caller.id,
    createdAt: at,
    updatedAt: at,
  };
  try {
    const project = await deps.db.transaction(async (tx) => {
      const inserted = await deps.repo.insert(tx, row);
      await ctx.emit(
        tx,
        PROJECT_CREATED,
        id,
        { projectId: id, slug: input.slug, actorId: caller.id },
        traceId,
      );
      return inserted;
    });
    return { kind: "ok", project };
  } catch (err) {
    // 记录没落下，仓库就不能留：不然是「有仓库没记录」（规格 P-06、P-20）。
    await ctx.discard(id, traceId);
    // 查重之后、写进来之前，另一个请求用同一个短名建成了：撞上唯一约束，不算建仓失败（规格 P-21）。
    if (isUniqueViolation(err)) return { kind: "slug_taken" };
    ctx.report("写记录", id, traceId, err);
    return { kind: "failed" };
  }
}
