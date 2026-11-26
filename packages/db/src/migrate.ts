import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/node-postgres/migrator";
import type { DatabaseHandle } from "./create.ts";

/**
 * 把迁移目录里的 SQL 按序号重放到库上。已经应用过的跳过。
 * 迁移目录由应用拥有（任务书 §8.2：线性、只前进、可在空库重放），这里只管执行。
 */
export async function runMigrations(
  handle: DatabaseHandle,
  migrationsFolder: string,
): Promise<void> {
  if (handle.kind === "postgres") {
    await migratePostgres(handle.db, { migrationsFolder });
    return;
  }
  await migratePglite(handle.db, { migrationsFolder });
}
