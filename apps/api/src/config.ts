import { z } from "zod";

/**
 * 环境变量是配置的唯一来源（实弹条款 7：不借 root 写配置文件）。
 * 读不出来、读错了就在启动时失败，不留到第一个请求。
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** 默认只听回环：前面有反向代理。本机开发也用回环，页面由开发服务器代理过来。 */
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4260),
  /** 端口被占时最多往后试几个（实弹条款 5：不假设端口空闲）。 */
  PORT_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(20),
  /** 给了就连真 Postgres；不给就用进程内的 PGlite。 */
  DATABASE_URL: z.string().min(1).optional(),
  DATA_DIR: z.string().min(1).default(".data"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = z.output<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`环境变量不合法：\n${lines.join("\n")}`);
  }
  return parsed.data;
}
