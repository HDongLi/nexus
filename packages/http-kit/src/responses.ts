import type { RouteConfig } from "@hono/zod-openapi";
import { errorBody } from "@nexus/contracts";
import type { ZodType } from "zod";

type Responses = RouteConfig["responses"];

/** 一个回 JSON 的响应：schema 就是处理函数返回的对象。 */
export function json<S extends ZodType>(schema: S, description: string) {
  return { description, content: { "application/json": { schema } } };
}

const REASONS: Record<number, string> = {
  400: "请求不合法",
  401: "没有登录，或登录已过期",
  403: "没有权限",
  404: "找不到",
  409: "和现有状态冲突",
  429: "试得太频繁，过一会儿再来",
  500: "服务器内部错误",
  503: "依赖的服务不可用",
};

/**
 * 声明这些状态码都回统一的错误形状。
 * 形状直接内联，不用 $ref：引用要把 schema 登记进文档，而登记依赖 @hono/zod-openapi 给 zod 打的补丁，
 * 补丁只对它加载之后才创建的 schema 生效。共享的 ErrorBody 定义得更早，所以走不了引用（2026-11-26 实测）。
 */
export function errors(...codes: number[]): Responses {
  const out: Responses = {};
  for (const code of codes) {
    out[String(code)] = {
      description: REASONS[code] ?? "失败",
      content: { "application/json": { schema: errorBody } },
    };
  }
  return out;
}
