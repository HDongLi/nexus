import { serve } from "@hono/node-server";
import type { Server } from "node:http";

export interface Listening {
  server: Server;
  port: number;
}

/** 监听只需要一样东西：应用的 fetch。不绑定 Hono 的具体类型，测试里也好造。 */
export interface FetchApp {
  fetch: (request: Request) => Promise<Response> | Response;
}

/**
 * 在首选端口上监听；被占了就往后试（实弹条款 5：不假设端口空闲）。
 * 实际端口由调用方读返回值，并且必须告诉使用者。
 */
export async function listenWithFallback(
  app: FetchApp,
  host: string,
  preferred: number,
  attempts: number,
): Promise<Listening> {
  let lastError: unknown;
  for (let port = preferred; port < preferred + attempts; port++) {
    try {
      const server = await tryListen(app, host, port);
      if (server) return { server, port };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`从 ${preferred} 起试了 ${attempts} 个端口都监听不了`, { cause: lastError });
}

function tryListen(app: FetchApp, host: string, port: number): Promise<Server | undefined> {
  // 不配 https 和 http2，所以拿回来的就是普通的 http.Server。
  const server = serve({
    fetch: app.fetch,
    hostname: host,
    port,
    overrideGlobalObjects: false,
  }) as Server;
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (err.code === "EADDRINUSE") resolve(undefined);
      else reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server);
    };
    server.on("error", onError);
    server.on("listening", onListening);
  });
}
