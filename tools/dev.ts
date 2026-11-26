// `pnpm dev`: one command, the whole stack, and nothing left running afterwards.
// 2026-11-26. Rules it follows (charter §11 rule 5): never assume a port is free, tell the user the
// real ports, and make both processes live and die with this one.
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const API_PREFERRED = 4260;

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function freePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 20; port++) {
    if (await canListen(port)) return port;
  }
  throw new Error(`从 ${preferred} 起试了 20 个端口都被占着`);
}

/**
 * Where the Vite command-line entry is. It is read from Vite's own manifest: the package's
 * `exports` does not expose bin/, so resolving that path by name is refused (2026-11-26).
 */
function viteBinary(from: string): string {
  const manifestPath = createRequire(from).resolve("vite/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin: { vite: string } };
  return join(dirname(manifestPath), manifest.bin.vite);
}

async function waitFor(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error("后端还没就绪就退出了，看上面的日志");
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // 还没起来，再等等。
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`等了 ${Math.round(timeoutMs / 1000)} 秒，${url} 还是没有响应`);
}

/** Windows 上直接结束进程留不下孤儿的方式是连子进程树一起结束；别处发 SIGTERM。 */
function stop(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function main(): Promise<void> {
  // 页面端口在后端端口定下来之后，从它上面一个开始找。两个都从固定起点各探各的，会把同一个
  // 端口发给两边：探测的时候谁都还没开始监听（2026-11-26）。
  const apiPort = await freePort(API_PREFERRED);
  const webPort = await freePort(apiPort + 1);
  const children: ChildProcess[] = [];
  let stopping = false;

  const stopAll = (): void => {
    if (stopping) return;
    stopping = true;
    for (const child of children) stop(child);
  };
  process.on("SIGINT", () => {
    stopAll();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stopAll();
    process.exit(143);
  });
  // 一个倒了另一个也不独活：同进同退。
  const watch = (child: ChildProcess): void => {
    child.on("exit", (code) => {
      if (stopping) return;
      stopping = true;
      for (const other of children) stop(other);
      process.exit(code ?? 1);
    });
  };

  const api = spawn(process.execPath, ["src/main.ts"], {
    cwd: join(ROOT, "apps", "api"),
    env: { ...process.env, PORT: String(apiPort) },
    stdio: "inherit",
  });
  children.push(api);
  watch(api);
  await waitFor(`http://127.0.0.1:${apiPort}/api/v1/system/health`, api, 60_000);

  // 直接用 Node 跑 vite 的入口文件，不经过 shell：拿得到真正的进程号，停得干净。
  const vite = viteBinary(join(ROOT, "apps", "web", "package.json"));
  const web = spawn(process.execPath, [vite, "--port", String(webPort), "--strictPort"], {
    cwd: join(ROOT, "apps", "web"),
    env: { ...process.env, API_PROXY: `http://127.0.0.1:${apiPort}` },
    stdio: "inherit",
  });
  children.push(web);
  watch(web);

  console.log(`\n  后端  http://127.0.0.1:${apiPort}    （健康探测 /api/v1/system/health）`);
  console.log(`  页面  http://127.0.0.1:${webPort}`);
  console.log("  按 Ctrl+C，两个一起停\n");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
