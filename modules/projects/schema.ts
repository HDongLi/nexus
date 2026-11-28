import { identityGroups, identityUsers } from "@nexus/identity";
import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * 工程模块的一张表（设计 02「表」）。只声明表，不依赖本模块的任何别的文件。
 *
 * 旧系统没有工程记录，以目录为准：清单靠扫目录，每个工程跑三四次 git（规格 P-07、P-09 的来源）。
 * 新版记录是事实的来源，仓库是记录名下的东西：记录在，仓库就该在（规格 P-06）。
 */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey(),
  /**
   * 全平台唯一，建后不改（规格 P-13、P-32）。
   * 应用层会先查一遍再建仓；这个唯一约束才是真正的保证：两个请求同时用同一个短名，只有一个进得来，
   * 撞上的那个回 409，不算建仓失败（规格 P-21）。
   */
  slug: text("slug").notNull().unique(),
  /** 给人看的名字。空串表示没有，页面上回落成短名。 */
  displayName: text("display_name").notNull(),
  /** 一到两个字符，或者空串。 */
  avatar: text("avatar").notNull(),
  /**
   * 创建者的账号编号。引用身份模块出口导出的表定义，不伸进它的 schema.ts（依赖方向检查只认出口）。
   * 删号时库拒绝：建过工程的账号不许删（规格「未确定」一节，2026-11-27 已定；人员规格 G-21）。
   * 只存编号，不读账号表：「这是谁」由页面另问同事名录（设计 02）。
   */
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => identityUsers.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  /** 建成时等于创建时间；显示名或头像字真的变了才动（规格 P-31）。 */
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * 「哪个组看得见哪些工程」的关系（设计 03「表」，规格 G-31）。这份关系归工程模块，
 * 组本身归身份模块：这里的组编号引用身份模块出口导出的表定义，不伸进它的内部文件（规格 G-31）。
 * 删工程、删组时关系随外键一起没了；删组不经过工程模块的代码，也不发工程的事件（规格 G-30、G-39）。
 */
export const projectGroups = pgTable(
  "project_groups",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => identityGroups.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.groupId] }),
    // 按组读可见的工程、认证时按人取组再查关系，都走这个索引（设计 03「表」）。
    index("project_groups_group_id_idx").on(table.groupId),
  ],
);
