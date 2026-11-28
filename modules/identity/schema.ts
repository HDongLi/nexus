import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * 身份模块的五张表（设计 01、设计 03「表」）。只声明表，不依赖本模块的任何别的文件。
 */

export const identityUsers = pgTable(
  "identity_users",
  {
    id: uuid("id").primaryKey(),
    /** 按原样保存。查找时不分大小写，所以下面另有一张唯一索引管着「不许两个用户名只差大小写」（规格 I-34）。 */
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    /**
     * argon2id 散列串，盐在串里，不另存（规格 I-06）。
     * 为空就是这个账号没有口令：登录时按口令不对处理，和用户名不存在分不出来（规格 I-10）。
     */
    passwordHash: text("password_hash"),
    /** 管理员位。我是谁回的值和访问闸判 admin 级，读的是同一个字段（规格 I-27）。 */
    isAdmin: boolean("is_admin").notNull().default(false),
    /** 为空就是启用。记时间点而不记布尔位，是为了留下「什么时候停用的」。 */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // 应用层会先查一遍再建号；这张索引是库那一层的保证，两个只差大小写的用户名并发建也进不来。
    uniqueIndex("identity_users_username_lower_idx").on(sql`lower(${table.username})`),
  ],
);

export const identitySessions = pgTable(
  "identity_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => identityUsers.id, { onDelete: "cascade" }),
    /** 令牌的 SHA-256。令牌原文只出现在 cookie 里，库里不存（规格 I-18）。 */
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /** 上一次续期的时间。不是「上一次使用」：每个请求都写它，等于给每个读请求加一次写（规格 I-22）。 */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // 登录时顺手删掉过期的会话行，按过期时间扫。
    index("identity_sessions_expires_at_idx").on(table.expiresAt),
    // 停用账号、改密时按人删会话。
    index("identity_sessions_user_id_idx").on(table.userId),
  ],
);

export const identityLoginFailures = pgTable("identity_login_failures", {
  /** 提交的用户名，转成小写。这是锁定的键（规格 I-12）。 */
  username: text("username").primaryKey(),
  failureCount: integer("failure_count").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  /** 锁到什么时候。为空就是没锁。锁定存在库里，进程重启不清零（规格 I-15）。 */
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

/**
 * 用户组（设计 03「表」，规格 G-25 到 G-30）。组不带角色，只带成员；
 * 「哪个组看得见哪些工程」不在这里，那是工程模块的关系表（规格 G-31）。
 */
export const identityGroups = pgTable(
  "identity_groups",
  {
    id: uuid("id").primaryKey(),
    /** 按去掉首尾空白后的原样（含大小写）保存。查找和查重不分大小写，靠下面这张唯一索引管着（规格 G-25）。 */
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /** 改名、换成员真的动了才更新（规格 G-28、G-29）。 */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // 应用层会先查一遍再建组；这张索引是库那一层的保证：两个只差大小写的组名并发建也进不来（规格 G-25）。
    uniqueIndex("identity_groups_name_lower_idx").on(sql`lower(${table.name})`),
  ],
);

/**
 * 用户组的成员（设计 03「表」）。一个账号可以在多个组里，也可以不在任何组里（规格「术语」）。
 * 删组、删号时成员关系随外键一起没了，不靠应用层一个个组去摘（规格 G-22、G-30）。
 */
export const identityGroupMembers = pgTable(
  "identity_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => identityGroups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => identityUsers.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    // 每个请求认证时要按人取组（设计 03「认证结果带上用户组」），停用不摘组，行一直在（规格 G-17）。
    index("identity_group_members_user_id_idx").on(table.userId),
  ],
);
