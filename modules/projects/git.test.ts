import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildEnv, createGitRunner, GIT_IDENTITY, GitError } from "./git.ts";

/**
 * 执行器本身：不起数据库，但起真的子进程。可执行文件换成 node，前置参数换成一段脚本，
 * 就是规格 P-22 说的那种桩。真的 git 建出来的仓库什么样，在 apps/api 的集成测试里验。
 */

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true });
});

const scratch = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};

/** 用 node 当可执行文件：`node <script> -- <args...>`。 */
const stub = (script: string, options: Parameters<typeof createGitRunner>[0] = {}) =>
  createGitRunner({ executable: process.execPath, preArgs: ["-e", script, "--"], ...options });

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("git 执行器（规格 P-18、P-22）", () => {
  it("跑得起来：标准输出和标准错误原样交回来", async () => {
    const git = stub("process.stdout.write('out'); process.stderr.write('note')");
    expect(await git.run(["version"], tmpdir())).toEqual({ stdout: "out", stderr: "note" });
  });

  it("非零退出、没能跑起来：拒绝；GitError 带上命令、退出码、标准错误", async () => {
    const failing = stub("process.stderr.write('boom'); process.exit(3)");
    const error: unknown = await failing.run(["init", "-b", "main"]).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(GitError);
    expect(error).toMatchObject({
      exitCode: 3,
      timedOut: false,
      stderr: "boom",
      args: ["init", "-b", "main"],
    });
    const missing = createGitRunner({
      executable: join(await scratch("nexus-no-git-"), "no-such-git"),
    });
    await expect(missing.run(["init"])).rejects.toMatchObject({ exitCode: null, timedOut: false });
  });

  it("一直挂着的命令：到点就结束那个子进程，回一个超时的 GitError；之后那个进程已经不在了", async () => {
    let killed: number | undefined;
    const hanging = stub("setTimeout(() => {}, 60000)", {
      timeoutMs: 300,
      onTimeout: (info) => {
        killed = info.pid;
      },
    });
    const started = performance.now();
    await expect(hanging.run(["init", "-b", "main"], tmpdir())).rejects.toMatchObject({
      timedOut: true,
      exitCode: null,
      args: ["init", "-b", "main"],
    });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(killed).toBeTypeOf("number");
    expect(alive(killed as number)).toBe(false);
  });

  it("不读服务器用户的 git 配置：系统配置关掉，全局配置是一个空文件，作者和提交者是模块常量（P-18）", async () => {
    // 造一份不一样的用户配置，放在 git 默认会读的位置；环境变量里也指一次
    const home = await scratch("nexus-git-home-");
    const userConfig = join(home, ".gitconfig");
    await writeFile(userConfig, "[user]\n\tname = Someone Else\n\temail = someone@example.com\n");
    const probe = stub(
      "process.stdout.write(JSON.stringify({nosystem: process.env.GIT_CONFIG_NOSYSTEM, global: process.env.GIT_CONFIG_GLOBAL, prompt: process.env.GIT_TERMINAL_PROMPT, author: [process.env.GIT_AUTHOR_NAME, process.env.GIT_AUTHOR_EMAIL], committer: [process.env.GIT_COMMITTER_NAME, process.env.GIT_COMMITTER_EMAIL]}))",
      { env: { HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: userConfig } },
    );
    const { stdout } = await probe.run(["var", "GIT_AUTHOR_IDENT"]);
    const env = JSON.parse(stdout) as Record<string, unknown>;
    expect(env.nosystem).toBe("1");
    expect(env.prompt).toBe("0");
    expect(env.author).toEqual([GIT_IDENTITY.name, GIT_IDENTITY.email]);
    expect(env.committer).toEqual([GIT_IDENTITY.name, GIT_IDENTITY.email]);
    // 全局配置是模块自己建的那个空文件，不是用户的：环境变量里指了也不算
    expect(env.global).not.toBe(userConfig);
    expect(await readFile(env.global as string, "utf8")).toBe("");
  });

  it("空的全局配置文件一个进程只建一份：几个执行器共用同一个，不按执行器攒目录", async () => {
    const print = "process.stdout.write(process.env.GIT_CONFIG_GLOBAL ?? '')";
    const first = await stub(print).run(["version"], tmpdir());
    const second = await stub(print).run(["version"], tmpdir());
    expect(first.stdout).toMatch(/nexus-git-[^\\/\s]*[\\/]gitconfig$/);
    expect(second.stdout).toBe(first.stdout);
  });

  it("buildEnv：隔离用的变量永远盖过外面给的，别的环境变量原样带着", () => {
    const env = buildEnv("/empty/gitconfig", {
      HOME: "/home/someone",
      GIT_CONFIG_GLOBAL: "/home/someone/.gitconfig",
      GIT_AUTHOR_NAME: "Someone",
    });
    expect(env.HOME).toBe("/home/someone");
    expect(env).toMatchObject({
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/empty/gitconfig",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: GIT_IDENTITY.name,
      GIT_AUTHOR_EMAIL: GIT_IDENTITY.email,
      GIT_COMMITTER_NAME: GIT_IDENTITY.name,
      GIT_COMMITTER_EMAIL: GIT_IDENTITY.email,
    });
    expect(buildEnv("/empty/gitconfig", undefined).GIT_CONFIG_GLOBAL).toBe("/empty/gitconfig");
  });
});
