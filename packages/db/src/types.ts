import type { ExtractTablesWithRelations } from "drizzle-orm";
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

/** 这个仓不往 drizzle 里登记关系，所以全库的表描述就是「空」。 */
type NoSchema = Record<string, never>;

/**
 * 一个打开的事务。事件要和业务写入同生共死时，把它传下去。
 *
 * 第三个类型参数要照 `transaction()` 实际交出来的写，不能用 PgTransaction 的缺省值：
 * 缺省是 `Record<string, never>`，交出来的却是 `ExtractTablesWithRelations<TFullSchema>`，
 * 两者在 `exactOptionalPropertyTypes` 下互相赋不上（2026-11-27 身份模块第一次真的开事务时暴露；
 * 骨架期这两个类型只被引用过，没被一个真事务赋值过）。
 */
export type Tx =
  | PgTransaction<NodePgQueryResultHKT, NoSchema, ExtractTablesWithRelations<NoSchema>>
  | PgTransaction<PgliteQueryResultHKT, NoSchema, ExtractTablesWithRelations<NoSchema>>;

/** 一个可执行 SQL 的连接、连接池，或者一个打开的事务。 */
export type Executor = Db | Tx;
