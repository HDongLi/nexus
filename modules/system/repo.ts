import type { Db } from "@nexus/db";
import { sql } from "drizzle-orm";

export interface SystemRepo {
  ping(): Promise<boolean>;
}

/** 本模块唯一写 SQL 的地方。它只问一句「数据库还在吗」。 */
export function createSystemRepo(db: Db): SystemRepo {
  return {
    async ping() {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
  };
}
