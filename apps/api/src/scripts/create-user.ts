import { createEventLog } from "@nexus/event-log";
import {
  createIdentityRepo,
  createIdentityService,
  type CreateUserRejection,
} from "@nexus/identity";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { openDatabase, pgliteDataDir } from "../database.ts";
import { loadConfig } from "../config.ts";

/**
 * 建账号（规格 I-46 到 I-48）。库是空的时候没有任何人能登录，所以有这条命令。
 * 在 apps/api 目录下运行：
 *
 *   node src/scripts/create-user.ts --username <用户名> --password-stdin [--admin]
 *   printf '%s\n' '<口令>' | node src/scripts/create-user.ts --username alice --admin --password-stdin
 *
 * 口令只从标准输入读第一行，去掉行尾换行。不收命令行参数，也不做交互式输入。
 * 它和正式进程读同一份配置（DATA_DIR 或 DATABASE_URL），自己跑迁移再写。
 *
 * 退出码：0 建成，标准输出一行 `created <用户名>`；1 被拒或出错，原因写在标准错误，不写库；
 * 2 用法不对。
 *
 * 开发库是进程内的 PGlite，一次只能被一个进程打开。服务在跑的时候建号，这里会照样打印「created」，
 * 服务那边却永远认不出这个账号（2026-11-27 实测：两个进程各看各的库）。所以开库之前先看数据目录里
 * 有没有别的进程留下的 postmaster.pid，有就拒。连真库（设了 DATABASE_URL）时没有这回事。口令不进命令行参数，不进标准输出、标准错误和日志（规格 I-47）：这个脚本不写任何日志。
 */

const USAGE = [
  "用法：node src/scripts/create-user.ts --username <用户名> --password-stdin [--admin]",
  "口令从标准输入读第一行。例如：",
  "  printf '%s\\n' '<口令>' | node src/scripts/create-user.ts --username alice --admin --password-stdin",
].join("\n");

/** 用法不对。和「被拒」分开，调用的人一眼看得出是自己敲错了，还是账号没建成。 */
class UsageError extends Error {}

interface Options {
  username: string;
  admin: boolean;
}

type Parsed = { ok: true; options: Options } | { ok: false; reason: string };

function parseArgs(argv: readonly string[]): Parsed {
  let username: string | undefined;
  let admin = false;
  let passwordStdin = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--admin") admin = true;
    else if (arg === "--password-stdin") passwordStdin = true;
    else if (arg === "--username") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, reason: "--username 后面要跟用户名" };
      }
      username = value;
      i++;
    } else return { ok: false, reason: `不认识的参数：${arg}` };
  }
  if (username === undefined) return { ok: false, reason: "没有给 --username" };
  if (!passwordStdin) return { ok: false, reason: "没有给 --password-stdin：口令只从标准输入读" };
  return { ok: true, options: { username, admin } };
}

/** 标准输入的第一行，去掉行尾换行。标准输入是一个终端时直接算用法不对：不在终端里等人口令。 */
async function readFirstLine(): Promise<string> {
  if (process.stdin.isTTY === true) throw new UsageError("口令要用管道送进来，不在终端里读。");
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text.split(/\r?\n/, 1)[0] ?? "";
}

async function assertEmbeddedDbFree(
  config: Pick<ReturnType<typeof loadConfig>, "DATABASE_URL" | "DATA_DIR">,
): Promise<void> {
  if (config.DATABASE_URL !== undefined) return;
  const marker = join(pgliteDataDir(config), "postmaster.pid");
  // PGlite 开着库的时候这个文件在，正常退出时删掉。它第一行写的是一个假的过程号，查不出那个进程还在不在，
  // 所以只看文件在不在。
  if (
    !(await access(marker).then(
      () => true,
      () => false,
    ))
  )
    return;
  throw new Error(
    `库正被另一个进程打开，多半是服务还在跑（${marker} 还在）。先停服务再建号；` +
      "服务确实没在跑的话，这是上次没有正常退出的残留，删掉这个文件再试",
  );
}

function describeRejection(
  reason: CreateUserRejection,
  username: string,
  minLength: number,
): string {
  switch (reason) {
    case "invalid_username":
      return `用户名不合规：${username}。只能是字母、数字、下划线、连字符，1 到 64 个字符`;
    case "username_taken":
      return `用户名已经存在（不分大小写）：${username}`;
    case "password_too_weak":
      return `口令太短：至少 ${minLength} 个字符`;
    case "password_too_long":
      return "口令太长：最多 128 个字符";
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) throw new UsageError(parsed.reason);

  const password = await readFirstLine();
  // 先于开库就拒掉：空的标准输入不碰库（规格 I-48）。
  if (password === "") throw new Error("标准输入是空的，没有读到口令");

  const config = loadConfig(process.env);
  await assertEmbeddedDbFree(config);
  const database = await openDatabase(config);
  try {
    const service = createIdentityService({
      db: database.db,
      repo: createIdentityRepo(),
      eventLog: createEventLog({ db: database.db }),
      passwordMinLength: config.PASSWORD_MIN_LENGTH,
    });
    const result = await service.createUser({
      username: parsed.options.username,
      password,
      isAdmin: parsed.options.admin,
    });
    if (result.kind === "rejected") {
      process.stderr.write(
        `${describeRejection(result.reason, parsed.options.username, config.PASSWORD_MIN_LENGTH)}\n`,
      );
      return 1;
    }
    process.stdout.write(`created ${result.user.username}\n`);
    return 0;
  } finally {
    await database.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n${USAGE}\n`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`建账号失败：${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  },
);
