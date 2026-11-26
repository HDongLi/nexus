import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * 两种驱动，一个入口。
 * - 给了 url：连真 Postgres。生产、彩排、发布前的复跑都用它。
 * - 没给 url：起一个进程内的 PGlite。开发和日常测试用它，本机不用装数据库（任务书 §4.1）。
 */
export type DatabaseHandle =
  | { kind: "postgres"; db: NodePgDatabase; close(): Promise<void> }
  | { kind: "pglite"; db: PgliteDatabase; close(): Promise<void> };

export interface DatabaseOptions {
  url?: string | undefined;
  /** PGlite 把库文件放在这个目录。不给就是纯内存库，进程退出即消失。 */
  dataDir?: string | undefined;
  poolSize?: number | undefined;
}

export async function createDatabase(options: DatabaseOptions = {}): Promise<DatabaseHandle> {
  if (options.url) {
    const pool = new Pool({ connectionString: options.url, max: options.poolSize ?? 10 });
    // 连不上就现在失败，不要等到第一个请求（证据先行：启动日志里就有原因）。
    await pool.query("select 1");
    return {
      kind: "postgres",
      db: drizzlePostgres(pool),
      close: () => pool.end(),
    };
  }
  if (options.dataDir) {
    // PGlite 自己建目录时不建父目录，父目录不在就当场失败（2026-11-26 首次启动实测）。
    mkdirSync(options.dataDir, { recursive: true });
  }
  const client = options.dataDir ? new PGlite(options.dataDir) : new PGlite();
  return {
    kind: "pglite",
    db: drizzlePglite(client),
    close: () => client.close(),
  };
}
