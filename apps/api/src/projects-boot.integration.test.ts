import { spawn, type ChildProcess } from "node:child_process";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { API_DIR, dataDirs, SPAWNING } from "./testing/create-user.ts";

/**
 * 配置项 PROJECTS_ROOT（规格 P-23）：真的起一个进程走启动装配，看启动时目录建没建出来、建不出来时拒不拒。
 * 启动一步就要连库、迁移、装配，所以每个用例给一分钟。
 */

const dirs = dataDirs();

afterAll(async () => {
  await dirs.removeAll();
});

interface Run {
  child: ChildProcess;
  /** 到此刻为止标准输出的每一行（启动日志是 JSON，一行一条）。 */
  lines(): string[];
  stderr(): string;
  /** 进程退出了就是退出码，还没退出是 undefined。 */
  exitCode(): number | null | undefined;
  closed: Promise<number | null>;
}

/** 起一个后端进程。环境变量里和这件事无关的项抹掉，开发者本机的设置不渗进来。 */
function start(extraEnv: Record<string, string>): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  for (const name of ["DATABASE_URL", "PUBLIC_ORIGIN", "PASSWORD_MIN_LENGTH", "NODE_ENV"]) {
    if (!(name in extraEnv)) delete env[name];
  }
  const child = spawn(process.execPath, ["src/main.ts"], {
    cwd: API_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  let code: number | null | undefined;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    err += chunk;
  });
  return {
    child,
    lines: () => out.split(/\r?\n/).filter(Boolean),
    stderr: () => err,
    exitCode: () => code,
    closed: new Promise((resolve) =>
      child.on("close", (exitedWith) => {
        code = exitedWith;
        resolve(exitedWith);
      }),
    ),
  };
}

const listening = (run: Run): boolean =>
  run.lines().some((line) => line.includes('"msg":"listening"'));

/** 等后端打出 listening。它要是先退出了，或者等太久，把它说过的最后几行一起报出来（证据先行）。 */
async function untilListening(run: Run): Promise<void> {
  const deadline = performance.now() + 40_000;
  const evidence = (): string => `${run.lines().slice(-8).join("\n")}\n${run.stderr()}`;
  while (!listening(run)) {
    if (run.exitCode() !== undefined)
      throw new Error(`后端没起来就退出了（${String(run.exitCode())}）：\n${evidence()}`);
    if (performance.now() > deadline) throw new Error(`等不到后端起来：\n${evidence()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** 停掉进程并等它退出：端口、数据目录都随之放开。 */
async function stop(run: Run): Promise<void> {
  run.child.kill();
  await run.closed;
}

describe("工程仓库的根目录（规格 P-23）", () => {
  it(
    "指向不存在的多级路径：启动后目录在，服务起来了，探活回 200",
    async () => {
      const dataDir = await dirs.fresh();
      const projectsRoot = join(dataDir, "deep", "nested", "projects");
      const run = start({ DATA_DIR: dataDir, PROJECTS_ROOT: projectsRoot });
      try {
        await untilListening(run);
        expect((await stat(projectsRoot)).isDirectory()).toBe(true);
        const line = run.lines().find((entry) => entry.includes('"msg":"listening"'));
        const port = (JSON.parse(line ?? "{}") as { port?: number }).port;
        expect(port).toBeTypeOf("number");
        const health = await fetch(`http://127.0.0.1:${String(port)}/api/v1/system/health`);
        expect(health.status).toBe(200);
      } finally {
        await stop(run);
      }
    },
    SPAWNING,
  );

  it(
    "指向建不出来的位置（上面压着一个普通文件）：启动被拒绝，原因写到标准错误；没走到连库那一步",
    async () => {
      const dataDir = await dirs.fresh();
      const blocker = join(dataDir, "blocker");
      await writeFile(blocker, "not a directory");
      const projectsRoot = join(blocker, "projects");
      const run = start({ DATA_DIR: dataDir, PROJECTS_ROOT: projectsRoot });

      const code = await run.closed;
      expect(code).not.toBe(0);
      expect(run.stderr()).toContain("启动失败");
      expect(run.stderr()).toContain(projectsRoot);
      // 目录建不出来就不往下走：数据目录里只有那个文件，没有库
      expect(await readdir(dataDir)).toEqual(["blocker"]);
    },
    SPAWNING,
  );
});
