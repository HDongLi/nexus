import type { Executor, Tx } from "@nexus/db";
import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { projectGroups, projects } from "./schema.ts";

/**
 * 可见性的「范围」：仓储照它在库里过滤（设计 03「工程模块这一侧」，规格 G-32）。
 * 管理员是全部；否则「创建者是我」或者「关系表里有我的任何一个组」。
 * 形状住在这里（SQL 要下推到仓储，形状跟着仓储走）；判定函数在 shared.ts，从这转出口。
 */
export type VisibilityScope =
  | { kind: "all" }
  | { kind: "filtered"; creatorId: string; groupIds: string[] };

/**
 * 本模块唯一写 SQL 的地方（铁律 4）。做成接口是为了能单独换成假的来测用例，也能在写入后故意抛错，
 * 来验「回到什么都没发生过」（规格 P-20）。每个方法都收一个执行者：连接池，或者调用方打开的事务。
 */

export type ProjectRecord = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

/**
 * 可见性的范围拼成 SQL 里的条件（规格 G-32，2026-11-28）：管理员（all）不加条件；
 * 否则「创建者是我」，或者「关系表里有我的任何一个组」。
 * 判定交出的是范围这个纯数据，SQL 只住在这里（铁律 4）。
 */
function scopeCondition(ex: Executor, scope: VisibilityScope): SQL | undefined {
  if (scope.kind === "all") return undefined;
  const conditions: SQL[] = [eq(projects.createdById, scope.creatorId)];
  if (scope.groupIds.length > 0) {
    // 子查询：关系表里有我的任何一个组的那些工程。
    const visible = ex
      .select({ id: projectGroups.projectId })
      .from(projectGroups)
      .where(inArray(projectGroups.groupId, scope.groupIds));
    conditions.push(inArray(projects.id, visible));
  }
  return conditions.length === 1 ? conditions[0] : or(...conditions);
}

export interface ProjectRepo {
  findBySlug(ex: Executor, slug: string): Promise<ProjectRecord | undefined>;
  findById(ex: Executor, id: string): Promise<ProjectRecord | undefined>;
  /** 全部记录，新的在前：创建时间降序，同一时刻的按编号降序（规格 P-08）。测试用来对账。 */
  listAll(ex: Executor): Promise<ProjectRecord[]>;
  /** 照可见性范围过滤的清单，次序同 listAll（规格 G-32）。 */
  listVisible(ex: Executor, scope: VisibilityScope): Promise<ProjectRecord[]>;
  /** 一条记录，且调用者的范围看得见它；看不见或不存在都回 undefined（规格 P-11、G-32）。 */
  visibleById(ex: Executor, id: string, scope: VisibilityScope): Promise<ProjectRecord | undefined>;
  insert(ex: Executor, row: NewProject): Promise<ProjectRecord>;
  /** 改显示名和头像字，顺手把更新时间挪到 at。 */
  updateProfile(
    ex: Executor,
    id: string,
    profile: { displayName: string; avatar: string },
    at: Date,
  ): Promise<void>;
  /** 这些编号里真实存在的工程（规格 G-27）。回存在的编号本身。 */
  existingIds(ex: Executor, ids: string[]): Promise<string[]>;

  /** 一个组看得见的工程编号，按编号排（规格 G-01 的表）。 */
  projectIdsForGroup(ex: Executor, groupId: string): Promise<string[]>;
  /** 整体替换一个组看得见的工程：先删光再插回去（规格 G-28）。 */
  replaceProjectsForGroup(tx: Tx, groupId: string, projectIds: string[]): Promise<void>;
  /** 给工程挂上组（建工程自动挂，规格 G-34）；已经挂上的忽略。 */
  insertProjectGroups(tx: Tx, groupId: string, projectIds: string[]): Promise<void>;
}

export function createProjectsRepo(): ProjectRepo {
  const order = [desc(projects.createdAt), desc(projects.id)] as const;
  return {
    async findBySlug(ex, slug) {
      const rows = await ex.select().from(projects).where(eq(projects.slug, slug));
      return rows[0];
    },
    async findById(ex, id) {
      const rows = await ex.select().from(projects).where(eq(projects.id, id));
      return rows[0];
    },
    async listAll(ex) {
      // 先按创建时间、再按编号：编号是随机生成的，同一毫秒建的两个工程也有确定的先后，清单不会两次刷新换位置。
      return ex
        .select()
        .from(projects)
        .orderBy(...order);
    },
    async listVisible(ex, scope) {
      const condition = scopeCondition(ex, scope);
      const query = ex
        .select()
        .from(projects)
        .orderBy(...order);
      return condition === undefined ? query : query.where(condition);
    },
    async visibleById(ex, id, scope) {
      const condition = scopeCondition(ex, scope);
      const where =
        condition === undefined ? eq(projects.id, id) : and(eq(projects.id, id), condition);
      const rows = await ex.select().from(projects).where(where);
      return rows[0];
    },
    async insert(ex, row) {
      const rows = await ex.insert(projects).values(row).returning();
      const inserted = rows[0];
      if (!inserted) throw new Error("工程写进去了却读不回来");
      return inserted;
    },
    async updateProfile(ex, id, profile, at) {
      await ex
        .update(projects)
        .set({ displayName: profile.displayName, avatar: profile.avatar, updatedAt: at })
        .where(eq(projects.id, id));
    },
    async existingIds(ex, ids) {
      if (ids.length === 0) return [];
      const rows = await ex
        .select({ id: projects.id })
        .from(projects)
        .where(inArray(projects.id, ids));
      return rows.map((row) => row.id);
    },
    async projectIdsForGroup(ex, groupId) {
      const rows = await ex
        .select({ projectId: projectGroups.projectId })
        .from(projectGroups)
        .where(eq(projectGroups.groupId, groupId))
        .orderBy(asc(projectGroups.projectId));
      return rows.map((row) => row.projectId);
    },
    async replaceProjectsForGroup(tx, groupId, projectIds) {
      await tx.delete(projectGroups).where(eq(projectGroups.groupId, groupId));
      if (projectIds.length > 0) {
        await tx
          .insert(projectGroups)
          .values(projectIds.map((projectId) => ({ groupId, projectId })));
      }
    },
    async insertProjectGroups(tx, groupId, projectIds) {
      if (projectIds.length === 0) return;
      await tx
        .insert(projectGroups)
        .values(projectIds.map((projectId) => ({ groupId, projectId })))
        .onConflictDoNothing();
    },
  };
}
