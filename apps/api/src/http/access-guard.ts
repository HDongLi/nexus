import type { Context, MiddlewareHandler } from "hono";
import type { AuthLevel } from "@nexus/contracts";
import { fail, type AnyRouteBinding, type AppEnv } from "@nexus/http-kit";

/** 验证调用者够不够级别。够就返回 undefined 放行；不够就返回要回给调用方的响应。 */
export type AccessVerifier = (
  c: Context<AppEnv>,
  level: Exclude<AuthLevel, "public">,
) => Promise<Response | undefined>;

interface Entry {
  method: string;
  pattern: RegExp;
  level: AuthLevel;
}

/** OpenAPI 的 {参数} 路径转成正则：一段里不含斜杠的任何内容。 */
function toPattern(path: string): RegExp {
  return new RegExp(`^${path.replace(/\{[^/}]+\}/g, "[^/]+")}$`);
}

/**
 * 访问闸：每条路由的访问级别是声明出来的，这里照着执行。
 * 表里查不到的一律不处理，回 404。查不到只有两种可能：路径本来就不存在；或者有人绕过了 route()，
 * 挂了一条没声明的路由。后者在这里看不出来，由契约测试在 L2 抓（每个挂上的操作都必须带访问级别）。
 */
export function accessGuard(
  bindings: readonly AnyRouteBinding[],
  verify: AccessVerifier,
): MiddlewareHandler<AppEnv> {
  const entries: Entry[] = bindings.map((binding) => ({
    method: binding.route.method.toUpperCase(),
    pattern: toPattern(binding.route.path),
    level: binding.access,
  }));

  return async (c, next) => {
    const entry = entries.find((e) => e.method === c.req.method && e.pattern.test(c.req.path));
    if (!entry) return fail(c, 404, "not_found", "没有这个接口");
    if (entry.level === "public") return next();
    return (await verify(c, entry.level)) ?? next();
  };
}
