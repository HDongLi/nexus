import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 跑 git 的执行器（规格 P-18、P-22）。
 *
 * 走异步子进程，每条命令带超时，超时就结束那个进程：旧系统建仓路上的 git 没有超时，页面给它等 5 分钟
 * （规格 P-22 的来源）。可执行文件、前置参数、超时、环境变量都从构造参数进来，测试换桩：
 * 验「一直挂起」时把可执行文件换成 node、前置参数换成 `-e "setTimeout(() => {}, 60000)" --`。
 *
 * 不读服务器用户的 git 配置：系统配置关掉，全局配置指向一个空文件，分支名和作者都显式给。
 * 旧系统的提交者身份里带着机器内部的域名（规格 P-18 的来源），新版是一组固定的常量。
 */

export interface GitOutput {
  stdout: string;
  stderr: string;
}

export interface GitRunner {
  /**
   * 跑一条 git 命令。非零退出、没能跑起来、超时，都拒绝（reject），原因在 GitError 里。
   * `args` 不含开头的 `git`；`cwd` 是这条命令的工作目录。
   */
  run(args: readonly string[], cwd?: string): Promise<GitOutput>;
}

/** 初始提交的作者和提交者（规格 P-18）。 */
export const GIT_IDENTITY = { name: "nexus", email: "nexus@localhost" } as const;

/** 每条命令的缺省超时。沿用旧系统单次 git 的超时，是初值、没有实测依据（规格「未确定」）。 */
export const GIT_TIMEOUT_MS = 30_000;

export class GitError extends Error {
  /** 这条命令的参数，不含开头的 git。排查时知道挂在哪一步。 */
  readonly args: readonly string[];
  /** 退出码。没能跑起来、或者被超时结束的，是 null。 */
  readonly exitCode: number | null;
  /** 标准错误输出。只进日志，不回给调用方：里面带服务器上的路径（规格 P-05）。 */
  readonly stderr: string;
  readonly timedOut: boolean;

  constructor(input: {
    args: readonly string[];
    exitCode: number | null;
    stderr: string;
    timedOut: boolean;
    timeoutMs: number | undefined;
    cause: unknown;
  }) {
    const what = input.args.join(" ");
    super(
      input.timedOut
        ? `git ${what}：${String(input.timeoutMs)} 毫秒内没有结束，已经结束这个进程`
        : input.exitCode === null
          ? `git ${what}：没能跑起来`
          : `git ${what}：退出码 ${String(input.exitCode)}`,
      { cause: input.cause },
    );
    this.name = "GitError";
    this.args = input.args;
    this.exitCode = input.exitCode;
    this.stderr = input.stderr;
    this.timedOut = input.timedOut;
  }
}

export interface GitRunnerOptions {
  /** 可执行文件，缺省 git。测试换成 node。 */
  executable?: string;
  /** 排在每条命令前面的参数。测试用：`["-e", "<脚本>", "--"]`。 */
  preArgs?: readonly string[];
  /** 每条命令的超时，毫秒，缺省 30 秒（规格 P-22）。 */
  timeoutMs?: number;
  /**
   * 追加的环境变量。隔离用的那几个（下面 buildEnv 里设的）永远盖过它。
   * 测试用：把 HOME 指到一份写着别的名字、别的默认分支的全局配置上，验模块确实不读它（规格 P-18）。
   */
  env?: NodeJS.ProcessEnv;
  /** 每结束一个超时的子进程调一次，带上它的进程号。测试用它验「超时后子进程已结束」。 */
  onTimeout?: (info: { pid: number | undefined; args: readonly string[] }) => void;
}

/** 一个全局配置文件都没有的 git：下面这些变量就是它的全部来路。 */
export function buildEnv(
  configFile: string,
  extra: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    // 系统级的配置整个不读。
    GIT_CONFIG_NOSYSTEM: "1",
    // 全局配置换成一个空文件。不给的话 git 读的是服务器用户的 ~/.gitconfig。
    GIT_CONFIG_GLOBAL: configFile,
    // 不许停下来问：命令行里没有人回答它。
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: GIT_IDENTITY.name,
    GIT_AUTHOR_EMAIL: GIT_IDENTITY.email,
    GIT_COMMITTER_NAME: GIT_IDENTITY.name,
    GIT_COMMITTER_EMAIL: GIT_IDENTITY.email,
  };
}

/**
 * 空的全局配置文件：一个进程一份，放在操作系统的临时目录里，第一次有人跑命令时才建。
 *
 * 不按执行器分——文件是空的，谁也不写它。按执行器分的话，集成测试每装配一次应用就多一个目录，
 * 跑一遍套件会在机器的临时目录里留下一百多个（2026-11-28 交付前清点：攒了 391 个）。
 * 进程退出不清：退出钩子里只做得动同步的事，这个模块里不许有同步调用；它只有一个名字、零个字节。
 */
let configFile: Promise<string> | undefined;

function getConfigFile(): Promise<string> {
  configFile ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "nexus-git-"));
    const file = join(dir, "gitconfig");
    await writeFile(file, "", "utf8");
    return file;
  })().catch((err: unknown) => {
    // 建失败了不记着：下一回重试，别把一次偶发的失败钉死。
    configFile = undefined;
    throw err;
  });
  return configFile;
}

export function createGitRunner(options: GitRunnerOptions = {}): GitRunner {
  const executable = options.executable ?? "git";
  const preArgs = options.preArgs ?? [];
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;

  return {
    async run(args, cwd) {
      const env = buildEnv(await getConfigFile(), options.env);
      const command = [...preArgs, ...args];
      return new Promise<GitOutput>((resolve, reject) => {
        const child = execFile(
          executable,
          command,
          {
            cwd,
            env,
            encoding: "utf8",
            timeout: timeoutMs,
            // 不给 SIGTERM 留余地：挂住的 git 未必会自己收尾。
            killSignal: "SIGKILL",
            // 后端不挂在控制台上，别让每一条 git 都闪一个窗口。
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            if (!error) {
              resolve({ stdout, stderr });
              return;
            }
            // 超时之后 Node 先结束子进程、等它的输出管道关掉，才调到这里：走到这里时那个进程已经不在了。
            const timedOut = error.killed === true;
            const exitCode = typeof error.code === "number" ? error.code : null;
            if (timedOut) options.onTimeout?.({ pid: child.pid, args });
            reject(
              new GitError({
                args,
                exitCode,
                stderr,
                timedOut,
                timeoutMs,
                cause: error,
              }),
            );
          },
        );
      });
    },
  };
}
