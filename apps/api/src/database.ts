import { createDatabase, runMigrations, type DatabaseHandle } from "@nexus/db";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.ts";

/** 迁移目录：全平台一份、线性、只前进（任务书 §8.2）。 */
export const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));

/** 进程内的库落在数据目录的哪一层。只给要看这个目录的脚本用。 */
export function pgliteDataDir(config: Pick<Config, "DATA_DIR">): string {
  return join(config.DATA_DIR, "pgdata");
}

/**
 * 打开库并迁移到最新。进程启动和建账号的脚本都走这一个函数：
 * 读同一份配置、落同一个数据目录、跑同一份迁移，脚本建出来的账号才一定是进程认得的（规格 I-46）。
 * PGlite 不建父目录之外的祖目录，dataDir 那一层由 @nexus/db 负责。
 */
export async function openDatabase(
  config: Pick<Config, "DATABASE_URL" | "DATA_DIR">,
): Promise<DatabaseHandle> {
  const database = await createDatabase({
    url: config.DATABASE_URL,
    dataDir: pgliteDataDir(config),
  });
  await runMigrations(database, migrationsFolder);
  return database;
}
