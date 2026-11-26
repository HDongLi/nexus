// Task scope gate (charter §6.4): a task's diff must stay inside the paths its card declares.
//
//   node tools/gates/scope.ts [--base <git ref>] [--task <id or branch name>]
//
// The task id comes from --task, or from the branch name when it starts with the id (t-0003-…).
// A branch without a task id is not judged: this gate only applies to task branches.
//
// 2026-11-26: also judges work that is not committed yet (staged, unstaged, untracked). L0 is
// the gate before a commit, so it has to see what is about to be committed.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Card {
  id: string;
  scope: string[];
}

interface Located extends Card {
  file: string;
}

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// Paths come back exactly as they are named. Without the first flag git quotes any non-ASCII
// path as octal escapes, and a quoted path never matches its own scope entry (seen with the
// Chinese file names under docs/adr).
const git = (...cmd: string[]): string =>
  execFileSync("git", ["-c", "core.quotepath=false", ...cmd], { encoding: "utf8" }).trim();

function findCard(task: string, dir: string): Located | undefined {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findCard(task, path);
      if (hit) return hit;
    } else if (entry.name === "tasks.json") {
      const cards = JSON.parse(readFileSync(path, "utf8")) as Card[];
      const hit = cards.find((card) => card.id.toUpperCase() === task);
      if (hit) return { ...hit, file: path };
    }
  }
  return undefined;
}

// Glob → regex. "**/" matches zero or more directories, "*" anything but a slash.
function toRegex(glob: string): RegExp {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          pattern += "(?:.*/)?";
        } else pattern += ".*";
      } else pattern += "[^/]*";
    } else pattern += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

// Paths any task may touch without declaring them.
const ALWAYS_ALLOWED = ["pnpm-lock.yaml"];

function main(): number {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const stated = opt("--task");
  const task = (
    stated !== undefined ? stated.match(/t-\d+/i) : branch.match(/^(t-\d+)/)
  )?.[0].toUpperCase();
  if (!task) {
    console.log(`scope    当前分支（${branch}）不是任务分支，跳过`);
    return 0;
  }
  const card = findCard(task, "docs/changes");
  if (!card) {
    console.log(`scope    找不到任务 ${task} 的任务卡（docs/changes/**/tasks.json）`);
    return 1;
  }

  const base = opt("--base") ?? "main";
  const files = new Set<string>();
  try {
    const fork = git("merge-base", base, "HEAD");
    // Committed, staged and unstaged changes against the fork point, plus files git does not
    // track yet: a new module is untracked until its first commit.
    for (const listing of [
      git("diff", "--name-only", fork),
      git("ls-files", "--others", "--exclude-standard"),
    ]) {
      for (const file of listing.split("\n")) if (file.trim()) files.add(file.trim());
    }
  } catch {
    // A base that was asked for by name and is missing is an error, not a pass. CI passes it
    // explicitly; silently passing there would switch this gate off without telling anyone.
    if (opt("--base") !== undefined) {
      console.log(`scope    拿不到与 ${base} 的分叉点`);
      return 1;
    }
    console.log(`scope    拿不到与 ${base} 的分叉点，跳过对比`);
    return 0;
  }

  const allowed = [...card.scope.map(toRegex), ...ALWAYS_ALLOWED.map(toRegex)];
  const outside = [...files].filter((file) => !allowed.some((re) => re.test(file)));
  console.log(
    `scope    ${task}  声明 ${card.scope.length} 条路径，改动 ${files.size} 个文件，越界 ${outside.length} 个`,
  );
  if (!outside.length) return 0;
  for (const file of outside) console.log(`         越界：${file}`);
  console.log(
    `         任务卡在 ${card.file}。要么把路径写进 scope 并经变更提案同意，要么把改动挪回范围内。`,
  );
  return 1;
}

process.exitCode = main();
