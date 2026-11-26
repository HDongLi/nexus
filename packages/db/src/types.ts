import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite/session";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres/session";
import type { PgTransaction } from "drizzle-orm/pg-core/session";

/**
 * 模块的仓储只认这两个类型，不关心底下是进程内的 PGlite 还是真 Postgres。
 * 写成两种具体驱动的并集，而不是抽象基类：这样查询结果里的行类型仍然是准的。
 */
export type Db = NodePgDatabase | PgliteDatabase;

/** 一个打开的事务。事件要和业务写入同生共死时，把它传下去。 */
export type Tx = PgTransaction<NodePgQueryResultHKT> | PgTransaction<PgliteQueryResultHKT>;

/** 一个可执行 SQL 的连接、连接池，或者一个打开的事务。 */
export type Executor = Db | Tx;
