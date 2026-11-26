import { API_PREFIX, errors, json, route } from "@nexus/http-kit";
import { z } from "zod";

/**
 * 这个模块的路由声明。只有形状，没有行为：生成契约文档时只 import 这一个文件，
 * 所以不需要数据库，也不需要启动进程。
 */

export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string().min(1),
  time: z.iso.datetime(),
  checks: z.object({
    db: z.enum(["ok", "fail"]),
  }),
});

export const bootRecordSchema = z.object({
  bootId: z.string().uuid(),
  startedAt: z.iso.datetime(),
  version: z.string().min(1),
});

export const systemInfoSchema = z.object({
  version: z.string().min(1),
  boot: bootRecordSchema,
  recentBoots: z.array(bootRecordSchema),
});

export const healthRoute = route("public", {
  method: "get",
  path: `${API_PREFIX}/system/health`,
  operationId: "getSystemHealth",
  summary: "健康探测",
  description: "给反向代理和守护进程用。进程活着但数据库连不上时回 503，响应体的形状不变。",
  tags: ["system"],
  responses: {
    200: json(healthSchema, "一切正常"),
    503: json(healthSchema, "进程活着，但有检查项不过"),
    ...errors(500),
  },
});

export const infoRoute = route("user", {
  method: "get",
  path: `${API_PREFIX}/system/info`,
  operationId: "getSystemInfo",
  summary: "本次启动与最近几次启动",
  tags: ["system"],
  responses: {
    200: json(systemInfoSchema, "版本、本次启动、最近五次启动"),
    ...errors(401, 403, 501, 500),
  },
});

/** 契约文档需要的全部内容。 */
export const systemContract = { name: "system", routes: [healthRoute, infoRoute] } as const;
