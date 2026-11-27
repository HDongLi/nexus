import { pino, type Logger } from "pino";
import { composeApp } from "./compose.ts";
import { openDatabase } from "./database.ts";
import { loadConfig } from "./config.ts";
import { listenWithFallback, type Listening } from "./listen.ts";
import { VERSION } from "./version.ts";

/** 停止时最多等这么久，超时强制退出，不留僵尸进程（实弹条款 15）。 */
const SHUTDOWN_GRACE_MS = 8000;

/**
 * 进程的一生：读配置 → 连库并迁移 → 装配模块 → 监听 → 等信号 → 干净地停。
 * 启动阶段的每一步失败都直接退出，并留下原因（证据先行）。
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const log = pino({ level: config.LOG_LEVEL, base: { service: "api", version: VERSION } });

  const database = await openDatabase(config);
  log.info({ database: database.kind }, "数据库就绪");

  // 模块怎么接在一起只有一份，在 compose.ts 里；测试用的也是它。
  const { app, bootId } = await composeApp({
    db: database.db,
    log,
    version: VERSION,
    runtime: process.version,
    publicOrigin: config.PUBLIC_ORIGIN,
    passwordMinLength: config.PASSWORD_MIN_LENGTH,
  });
  const { server, port } = await listenWithFallback(
    app,
    config.HOST,
    config.PORT,
    config.PORT_ATTEMPTS,
  );
  log.info({ host: config.HOST, port, preferredPort: config.PORT, bootId }, "listening");

  installShutdown(log, server, async () => {
    await database.close();
  });
}

function installShutdown(
  log: Logger,
  server: Listening["server"],
  close: () => Promise<void>,
): void {
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "正在停止");
    const force = setTimeout(() => {
      log.error("停止超时，强制退出");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    try {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await close();
      log.info("已停止");
      process.exit(0);
    } catch (err) {
      log.error({ err }, "停止时出错");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => stop("SIGINT").catch(() => process.exit(1)));
  process.on("SIGTERM", () => stop("SIGTERM").catch(() => process.exit(1)));
}

main().catch((err: unknown) => {
  console.error("启动失败：", err);
  process.exit(1);
});
