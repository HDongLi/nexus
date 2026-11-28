import type { Executor } from "@nexus/db";
import { desc, eq } from "drizzle-orm";
import { projects } from "./schema.ts";

/**
 * 本模块唯一写 SQL 的地方（铁律 4）。做成接口是为了能单独换成假的来测用例，也能在写入后故意抛错，
 * 来验「回到什么都没发生过」（规格 P-20）。每个方法都收一个执行者：连接池，或者调用方打开的事务。
 */

export type ProjectRecord = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export interface ProjectRepo {
  findBySlug(ex: Executor, slug: string): Promise<ProjectRecord | undefined>;
  findById(ex: Executor, id: string): Promise<ProjectRecord | undefined>;
  /**
   * 全部记录，新的在前：创建时间降序，同一时刻的按编号降序（规格 P-08）。
   * 谁看得见哪条不归这里管：可见性判定要问过调用者，那是用例的事。
   */
  listAll(ex: Executor): Promise<ProjectRecord[]>;
  insert(ex: Executor, row: NewProject): Promise<ProjectRecord>;
  /** 改显示名和头像字，顺手把更新时间挪到 at。 */
  updateProfile(
    ex: Executor,
    id: string,
    profile: { displayName: string; avatar: string },
    at: Date,
  ): Promise<void>;
}

export function createProjectsRepo(): ProjectRepo {
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
      return ex.select().from(projects).orderBy(desc(projects.createdAt), desc(projects.id));
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
  };
}
