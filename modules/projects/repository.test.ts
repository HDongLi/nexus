import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitError } from "./git.ts";
import { INITIAL_FILES } from "./initial-files.ts";
import { buildRepository, INITIAL_COMMIT_SUBJECT } from "./repository.ts";
import { createFakeGit, type FakeGit } from "./testing/fake.ts";

/**
 * 建仓的几步：git 是桩，所以这里只看「提交之前落脚目录里写了什么」和「收场收得干不干净」。
 * 真的 git 建出来的仓库能不能克隆、分支对不对，在 apps/api 的集成测试里验（规格 P-16、P-18）。
 */

const ID = "30000000-0000-4000-8000-000000000001";
const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true });
});

const scratch = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "nexus-projects-repo-"));
  created.push(dir);
  return dir;
};

describe("建仓（规格 P-17、P-19、P-20）", () => {
  it("提交之前落脚目录里恰好三个文件，内容照规格；clone 的目标是根目录下的 <编号>.git；建成后落脚目录和 .tmp 都删了", async () => {
    const root = await scratch();
    const git = createFakeGit();
    const seen: { names: string[]; files: Record<string, string> } = { names: [], files: {} };
    git.afterCall = async (call) => {
      if (call.args[0] !== "commit" || call.cwd === undefined) return;
      seen.names = (await readdir(call.cwd)).filter((name) => name !== ".git").sort();
      for (const name of INITIAL_FILES)
        seen.files[name] = await readFile(join(call.cwd, name), "utf8");
    };

    await buildRepository({ root, id: ID, title: "甲的工程", git });

    expect(seen.names).toEqual([".gitignore", "AGENTS.md", "README.md"]);
    // README 只有一行：# 加工程名
    expect(seen.files["README.md"]).toBe("# 甲的工程\n");
    // AGENTS.md 是 Markdown，一级标题是工程名，一段话说清三件事
    expect(seen.files["AGENTS.md"]).toMatch(/^# 甲的工程\n\n[^\n#]+\n$/u);
    expect(seen.files["AGENTS.md"]).toContain("平台");
    expect(seen.files["AGENTS.md"]).toContain("`main`");
    expect(seen.files["AGENTS.md"]).toContain("智能体");
    // .gitignore 只列跟技术栈无关的三类
    const entries = (seen.files[".gitignore"] ?? "")
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"));
    expect(entries).toEqual([
      ".DS_Store",
      "Thumbs.db",
      "Desktop.ini",
      ".env",
      ".env.*",
      "!.env.example",
      "*.log",
    ]);
    expect(seen.files[".gitignore"]).not.toContain("node_modules");

    expect(git.calls.map((call) => call.args)).toEqual([
      ["init", "-b", "main"],
      ["add", "--", "README.md", "AGENTS.md", ".gitignore"],
      ["commit", "-m", INITIAL_COMMIT_SUBJECT],
      ["clone", "--bare", "--", join(root, ".tmp", ID), join(root, `${ID}.git`)],
    ]);
    expect(await readdir(root)).toEqual([]);
  });

  it("没有显示名时，仓库里的标题用短名（P-17）", async () => {
    const root = await scratch();
    const git = createFakeGit();
    let readme = "";
    git.afterCall = async (call) => {
      if (call.args[0] === "commit" && call.cwd)
        readme = await readFile(join(call.cwd, "README.md"), "utf8");
    };
    await buildRepository({ root, id: ID, title: "alpha", git });
    expect(readme).toBe("# alpha\n");
  });

  it("任何一步失败：落脚目录、.tmp、半截的裸仓库都不留（P-20）", async () => {
    for (let step = 1; step <= 4; step++) {
      const root = await scratch();
      const git: FakeGit = createFakeGit();
      git.failAt = step;
      if (step === 4) {
        // clone 走到一半：先造出半个裸仓库，再看失败之后它有没有被收走
        git.afterCall = async (call) => {
          if (call.args[0] === "clone")
            await mkdir(call.args.at(-1) as string, { recursive: true });
        };
      }
      await expect(buildRepository({ root, id: ID, title: "甲", git })).rejects.toBeInstanceOf(
        GitError,
      );
      expect(git.calls).toHaveLength(step);
      expect(await readdir(root)).toEqual([]);
    }
  });
});
