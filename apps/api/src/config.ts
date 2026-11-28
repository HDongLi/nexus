import { join } from "node:path";
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
  /**
   * 对外地址，形如 https://nexus.example.com，不带路径。写请求的 Origin 要和它对得上（规格 I-37、I-38）。
   * 不配就按请求自己的地址比：开发时页面服务转给后端不改写主机名，所以不用配。
   * 生产必填：反向代理改写了 Host 或者协议，按请求自己的地址比对会对不上。启动时校验，不合法就起不来。
   */
  PUBLIC_ORIGIN: z.string().trim().optional(),
  /** 口令最短长度。改密和建号都查它。只查长度，不查字符种类（规格 I-32）。 */
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(1).max(128).default(8),
  /**
   * 工程的裸仓库放在哪（规格 P-23）。不给就是 `<DATA_DIR>/projects`。
   * 留空算配错、起不来：一个空的路径配置多半是从模板抄下来忘了填，按「没给」处理会把仓库悄悄放进数据目录。
   */
  PROJECTS_ROOT: z.string().min(1).optional(),
});

/** 工程仓库根目录的缺省值：数据目录下的 projects（规格 P-23）。 */
export function defaultProjectsRoot(dataDir: string): string {
  return join(dataDir, "projects");
}

export type Config = z.output<typeof schema> & { PROJECTS_ROOT: string };

/**
 * 校验对外地址：http 或 https、有主机名、不带路径、查询串、片段和账号（规格 I-38）。
 * 末尾一个斜杠和没有斜杠是同一个地址，收下；回的是规范形式（小写的主机名，去掉默认端口）。
 * 空串按没配处理：shell 里 `PUBLIC_ORIGIN=` 留空，意思是「不设」。
 */
export function parsePublicOrigin(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("不是合法的地址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("协议只能是 http 或 https");
  if (url.username !== "" || url.password !== "") throw new Error("不能带账号和口令");
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error("不能带路径、查询串或片段");
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`环境变量不合法：\n${lines.join("\n")}`);
  }
  let publicOrigin: string | undefined;
  try {
    publicOrigin = parsePublicOrigin(parsed.data.PUBLIC_ORIGIN);
  } catch (err) {
    throw new Error(`环境变量不合法：\nPUBLIC_ORIGIN: ${(err as Error).message}`, { cause: err });
  }
  return {
    ...parsed.data,
    PUBLIC_ORIGIN: publicOrigin,
    PROJECTS_ROOT: parsed.data.PROJECTS_ROOT ?? defaultProjectsRoot(parsed.data.DATA_DIR),
  };
}
