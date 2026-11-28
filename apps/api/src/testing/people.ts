import type { Db } from "@nexus/db";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { boot, loginAs, seedUser, type TestApp } from "./kit.ts";

/**
 * 人员与用户组集成测试的公用件：种用户组、查表、清表。只有 *.integration.test.ts 会 import。
 * 账号和登录的帮手在 kit.ts（seedUser、loginAs），工程的在 projects.ts。
 */

export const PASSWORD = "alice-password-1";

/** 人员与用户组的路径。 */
export const PEOPLE = {
  users: "/api/v1/users",
  user: (id: string): string => `/api/v1/users/${id}`,
  password: (id: string): string => `/api/v1/users/${id}/password`,
  disable: (id: string): string => `/api/v1/users/${id}/disable`,
  enable: (id: string): string => `/api/v1/users/${id}/enable`,
  member: (id: string): string => `/api/v1/users/${id}`,
  people: "/api/v1/people",
  groups: "/api/v1/groups",
  group: (id: string): string => `/api/v1/groups/${id}`,
  members: (id: string): string => `/api/v1/groups/${id}/members`,
} as const;

/** 直接往表里放一个用户组（成员关系另放）。不走用例：要什么形状的行就放什么形状的行。 */
export async function seedGroup(
  db: Db,
  input: { name: string; memberIds?: string[]; createdAt?: Date },
): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  const at = input.createdAt ?? new Date();
  await db.execute(
    sql`insert into identity_groups (id, name, created_at, updated_at) values (${id}, ${input.name}, ${at.toISOString()}, ${at.toISOString()})`,
  );
  for (const memberId of input.memberIds ?? []) {
    await db.execute(
      sql`insert into identity_group_members (group_id, user_id) values (${id}, ${memberId})`,
    );
  }
  return { id, name: input.name };
}

export interface GroupRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export async function groupRows(db: Db): Promise<GroupRow[]> {
  const rows = await db.execute(
    sql`select id, name, created_at, updated_at from identity_groups order by created_at, id`,
  );
  return (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  }));
}

export async function memberRows(db: Db): Promise<Array<{ group_id: string; user_id: string }>> {
  const rows = await db.execute(
    sql`select group_id, user_id from identity_group_members order by group_id, user_id`,
  );
  return (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    group_id: row.group_id as string,
    user_id: row.user_id as string,
  }));
}

/** 清掉用户组和成员关系，以及它们的事件。工程的关系表引用组，先清工程（clearProjects）再清这里。 */
export async function clearGroups(db: Db): Promise<void> {
  await db.execute(sql`delete from identity_group_members`);
  await db.execute(sql`delete from identity_groups`);
  await db.execute(
    sql`delete from events where source = 'identity' and type like 'identity.group.%'`,
  );
}

/** 一个装好的应用，加一个已经登录的管理员。账号和登录都要真算散列，一个文件里只做一回。 */
export async function adminSession(
  db: Db,
  username = "chief",
): Promise<{ api: TestApp; userId: string; cookie: string }> {
  const api = await boot({ db });
  const user = await seedUser(db, { username, password: PASSWORD, isAdmin: true });
  const reply = await loginAs(api.app, username, PASSWORD);
  if (reply.status !== 200) throw new Error(`${username} 没登录上：${String(reply.status)}`);
  return { api, userId: user.id, cookie: reply.cookie };
}
