import { z } from "zod";

/**
 * 一条路由的访问级别。每条路由都必须声明，没有默认值。
 * 旧系统的教训：好几条接口从上线起就没鉴权（docs/parity/backlog.md 的 B-005 到 B-007）。
 */
export const authLevels = ["public", "user", "admin"] as const;
export const authLevel = z.enum(authLevels);

export type AuthLevel = z.output<typeof authLevel>;
