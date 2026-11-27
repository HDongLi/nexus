import { createDatabase, runMigrations, type DatabaseHandle } from "@nexus/db";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationsFolder } from "../database.ts";
import { boot, identityEvents, userRows } from "./kit.ts";

/**
 * 给建账号脚本的集成测试用的：真的起一个进程跑脚本，口令走管道，库落在临时目录里；
 * 脚本退出之后，这边再打开同一个库，看它到底写没写。
 * 起进程慢（空库上头一次约 3 秒，之后约 1.5 秒），所以用例按「成功的」和「被拒的」分成两个文件并行跑。
 */

/** apps/api 的目录：脚本约定在这里运行。 */
export const API_DIR = join(import.meta.dirname, "../..");
/** 每个用例都要起一两个真进程，测试进程这一边再开一次库也要一秒多。vitest 默认的 5 秒不够。 */
export const SPAWNING = 60_000;
export const PASSWORD = "first-admin-pw";

export interface ScriptRun {
  code: number | null;
  stdout: string;
  stderr: string;
  /** 进程收到的参数（不含 node 自己）。 */
  argv: string[];
}

/**
 * 跑一次脚本。stdin 给 null 表示管道一打开就关上，也就是标准输入是空的。
 * 环境变量里和这件事无关的项一律抹掉，开发者本机的设置不渗进测试。
 */
export function runCreateUser(
  args: string[],
  stdin: string | null,
  dataDir: string,
  extraEnv: Record<string, string> = {},
): Promise<ScriptRun> {
  const script = join("src", "scripts", "create-user.ts");
  const env: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: dataDir, ...extraEnv };
  for (const name of ["DATABASE_URL", "PUBLIC_ORIGIN", "PASSWORD_MIN_LENGTH", "NODE_ENV"]) {
    if (!(name in extraEnv)) delete env[name];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: API_DIR,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, argv: [script, ...args] }));
    if (stdin === null) child.stdin.end();
    else child.stdin.end(stdin);
  });
}

export interface DataDirs {
  /** 一个新的临时目录，交给一次脚本运行当数据目录。 */
  fresh(): Promise<string>;
  /** 把开出来的目录全删掉。用例文件的 afterAll 里调。 */
  removeAll(): Promise<void>;
}

export function dataDirs(): DataDirs {
  const created: string[] = [];
  return {
    async fresh() {
      const dir = await mkdtemp(join(tmpdir(), "nexus-create-user-"));
      created.push(dir);
      return dir;
    },
    async removeAll() {
      for (const dir of created)
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/**
 * 目录下（递归）内容含这段文字的文件。按字节找：库文件和预写日志是二进制的，不能当文本读。
 * 用来证「口令没有落盘」：脚本跑完之后整个数据目录扫一遍，一处都不许有。
 */
export async function filesContaining(dir: string, text: string): Promise<string[]> {
  const needle = Buffer.from(text, "utf8");
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
  const contents = await Promise.all(files.map((file) => readFile(file)));
  return files.filter((_, index) => contents[index]?.includes(needle) === true);
}

/** 打开脚本落在那个目录里的库，装一个应用，好拿真路由验账号能不能用。调用方负责 close。 */
export async function openCreated(
  dataDir: string,
): Promise<{ database: DatabaseHandle; api: Awaited<ReturnType<typeof boot>> }> {
  const database = await createDatabase({ dataDir: join(dataDir, "pgdata") });
  await runMigrations(database, migrationsFolder);
  const api = await boot({ db: database.db });
  return { database, api };
}

/** 库里有多少账号、多少条建号事件。 */
export async function counts(dataDir: string): Promise<{ users: number; created: number }> {
  const { database } = await openCreated(dataDir);
  try {
    return {
      users: (await userRows(database.db)).length,
      created: (await identityEvents(database.db, "identity.user.created")).length,
    };
  } finally {
    await database.close();
  }
}
