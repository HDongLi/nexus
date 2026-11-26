import { createDatabase, runMigrations } from "@nexus/db";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { z } from "zod";

/**
 * 迁移目录的自检（L2 闸，任务书 §6.5「迁移可重放」）：
 * ① 序号从 0 起连续，每个条目都有对应的 SQL 文件；
 * ② 在一个空的内存库上从头重放一遍能成；
 * ③ 再放一遍什么都不做。
 *
 * 没给 DATABASE_URL 时落在内存库（PGlite）上，开发机上随手可跑；给了就在那个真库上重放，
 * CI 每次推送都带一个 Postgres 服务（2026-11-26 加：进程内库和真库的方言差异只有在真库上才露出来）。
 */
const folder = fileURLToPath(new URL("../../drizzle/", import.meta.url));
const journalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string().min(1) })),
});

async function main(): Promise<void> {
  const journal = journalSchema.parse(
    JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")),
  );
  journal.entries.forEach((entry, i) => {
    if (entry.idx !== i) throw new Error(`迁移序号断了：第 ${i} 条的 idx 是 ${entry.idx}`);
    if (!existsSync(join(folder, `${entry.tag}.sql`)))
      throw new Error(`迁移 ${entry.tag} 没有 SQL 文件`);
  });

  const url = process.env.DATABASE_URL;
  const db = await createDatabase(url ? { url } : {});
  try {
    await runMigrations(db, folder);
    if (db.kind !== (url ? "postgres" : "pglite")) throw new Error("自检没有落在预期的那一种库上");
    const first = await db.db.execute<{ hash: string }>(
      sql`select hash from drizzle.__drizzle_migrations`,
    );
    await runMigrations(db, folder);
    const second = await db.db.execute<{ hash: string }>(
      sql`select hash from drizzle.__drizzle_migrations`,
    );
    if (first.rows.length !== journal.entries.length || second.rows.length !== first.rows.length) {
      throw new Error(
        `迁移条数不对：日志 ${journal.entries.length}，第一次重放 ${first.rows.length}，第二次 ${second.rows.length}`,
      );
    }
    console.log(
      `迁移自检通过（${url ? "真库" : "内存库"}）：${journal.entries.length} 条，空库可重放，重放幂等`,
    );
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
