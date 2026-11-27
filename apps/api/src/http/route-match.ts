import type { AnyRouteBinding } from "@nexus/http-kit";

/** 一条声明在运行时的样子：方法、路径的正则、这条路由自己。 */
export interface RouteEntry<T> {
  method: string;
  pattern: RegExp;
  value: T;
}

/** OpenAPI 的 {参数} 路径转成正则：一段里不含斜杠的任何内容。 */
export function toPattern(path: string): RegExp {
  return new RegExp(`^${path.replace(/\{[^/}]+\}/g, "[^/]+")}$`);
}

/** 把一批路由声明按「方法加路径」排成表。访问闸和请求体检查都靠它查表，查不到的一律不认。 */
export function routeTable<T>(
  bindings: readonly AnyRouteBinding[],
  pick: (binding: AnyRouteBinding) => T | undefined,
): RouteEntry<T>[] {
  const entries: RouteEntry<T>[] = [];
  for (const binding of bindings) {
    const value = pick(binding);
    if (value === undefined) continue;
    entries.push({
      method: binding.route.method.toUpperCase(),
      pattern: toPattern(binding.route.path),
      value,
    });
  }
  return entries;
}

export function findEntry<T>(
  table: readonly RouteEntry<T>[],
  method: string,
  path: string,
): T | undefined {
  return table.find((entry) => entry.method === method && entry.pattern.test(path))?.value;
}
