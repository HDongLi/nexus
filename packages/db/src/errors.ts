/**
 * 数据库驱动的报错里，应用要认的那几类。只认形状，不关心背后是 PGlite 还是真 Postgres。
 */

/**
 * Postgres 的「违反唯一约束」（SQLSTATE 23505）。
 *
 * 要沿着 cause 往下找：drizzle 把查询错误包成自己的 DrizzleQueryError，数据库的错误码在它的
 * cause 上，最外层没有 code。只看最外层的话，并发撞唯一约束的输家会被当成别的失败
 * （2026-11-28，工程模块建短名的并发实弹发现的，规格 P-21；身份模块的同款写法一并换掉）。
 * 进程内的库一次只跑一个事务，测试造不出真并发，所以这条没有专门的用例：工程模块的
 * 集成测试用真库跑过并发场景（P-21）。
 */
export function isUniqueViolation(err: unknown): boolean {
  let current = err;
  // cause 链不会长；封个顶，免得遇到环就出不来了。
  for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Postgres 的「引用约束不许」：`ON DELETE RESTRICT`（SQLSTATE 23001）和一般的外键拒绝（23503）。
 *
 * 两个都要认（2026-11-28，人员模块删号实弹约定）：这套进程内的库基于新版的 Postgres，
 * RESTRICT 被拒绝时报 23001，老版本的 Postgres 报 23503；只认一个就会把 409 翻译成 500。
 * 删账号时全库只有工程的 `projects.created_by_id` 是 RESTRICT，所以被拦下的唯一原因就是
 * 「这个账号建过工程」（规格 G-21）。cause 链的走法同 isUniqueViolation。
 */
export function isForeignKeyViolation(err: unknown): boolean {
  let current = err;
  for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth++) {
    const code = (current as { code?: unknown }).code;
    if (code === "23001" || code === "23503") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
