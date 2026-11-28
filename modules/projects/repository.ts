import { mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GitRunner } from "./git.ts";
import { DEFAULT_BRANCH, INITIAL_FILES, initialFiles } from "./initial-files.ts";

/**
 * 平台替人建并管理的裸仓库：怎么建、怎么读最新提交、怎么扔掉。不碰数据库，那是用例的事。
 */

/**
 * 初始提交的说明。规格只要求详情回它的第一行（P-25），没定文案。
 * 用 ASCII：说明经命令行参数传进去，中文在 Windows 上有被转成问号的风险（建账号脚本踩过同类问题）。
 */
export const INITIAL_COMMIT_SUBJECT = "Initial commit";

/**
 * 建仓期间的落脚目录，在根目录下面；用完就删，空了也删。
 * 规格 P-19 的验收是「新建后 `PROJECTS_ROOT` 恰好多一个 `<编号>.git`」，落脚目录留着就多了。
 */
export const SCRATCH_DIR = ".tmp";

/** 默认分支最新一次提交（规格 P-25）。 */
export interface ProjectHead {
  commitId: string;
  /** 提交者的时间，换算成 UTC：接口上别的时间都是这个形式。 */
  committedAt: string;
  /** 提交说明的第一行。 */
  subject: string;
}

/**
 * 目录名取编号不取短名（规格 P-19，2026-11-27 新决定）：短名以后可能随删除功能被重用，
 * 崩溃留下的半截目录也不该占住一个短名。旧系统是 `<短名>.git`。
 */
const bareRepo = (root: string, id: string): string => join(root, `${id}.git`);
const scratchRepo = (root: string, id: string): string => join(root, SCRATCH_DIR, id);

/**
 * 删掉一个目录；它本来就不在不算错。回 false 表示删不掉。
 * Windows 上别的程序（杀毒软件扫新文件）可能正开着里面的文件，稍等重试几次。
 */
async function remove(path: string): Promise<boolean> {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    return true;
  } catch {
    return false;
  }
}

/** 落脚目录用完就删；整个 .tmp 空了也删。别的请求还在用时删不掉，那是应当的，不算错。 */
async function clearScratch(root: string, id: string): Promise<void> {
  await remove(scratchRepo(root, id));
  await rmdir(join(root, SCRATCH_DIR)).catch(() => undefined);
}

/**
 * 建一个裸仓库（设计 02「建仓」的第 3、4 步）：落脚目录里 `git init`、写三个文件、`git add`、`git commit`，
 * 再 `git clone --bare` 到 `PROJECTS_ROOT/<编号>.git`，删掉落脚目录。
 *
 * 任何一步失败都把刚建的东西删干净再抛，回到什么都没发生过（规格 P-20）。调用方接着还要写记录，
 * 那一步失败时由调用方调 discardRepository。
 */
export async function buildRepository(options: {
  root: string;
  id: string;
  title: string;
  git: GitRunner;
}): Promise<void> {
  const { root, id, git } = options;
  const work = scratchRepo(root, id);
  const bare = bareRepo(root, id);
  try {
    await mkdir(work, { recursive: true });
    // 分支名显式给：不读服务器用户的 init.defaultBranch（规格 P-18）。
    await git.run(["init", "-b", DEFAULT_BRANCH], work);
    for (const file of initialFiles(options.title)) {
      await writeFile(join(work, file.path), file.content, "utf8");
    }
    await git.run(["add", "--", ...INITIAL_FILES], work);
    await git.run(["commit", "-m", INITIAL_COMMIT_SUBJECT], work);
    await git.run(["clone", "--bare", "--", work, bare]);
  } catch (err) {
    // clone 走到一半失败会留下半个目录。
    await remove(bare);
    throw err;
  } finally {
    await clearScratch(root, id);
  }
}

/** 扔掉一个裸仓库。回 false 表示没删掉：那就剩下了「有仓库没记录」，调用方要记日志（规格 P-06）。 */
export async function discardRepository(root: string, id: string): Promise<boolean> {
  return remove(bareRepo(root, id));
}

/**
 * 读默认分支最新一次提交，只跑一次 git（规格 P-25）。
 * 失败、超时、输出读不出提交，都抛：详情那头回 500，不回一个 `head` 为空的详情（规格 P-26）。
 */
export async function readHead(options: {
  root: string;
  id: string;
  git: GitRunner;
}): Promise<ProjectHead> {
  const { stdout } = await options.git.run([
    "--git-dir",
    bareRepo(options.root, options.id),
    "log",
    "-1",
    // 编号、提交者的时间（ISO 8601）、说明的第一行，各占一行。
    "--format=%H%n%cI%n%s",
    DEFAULT_BRANCH,
  ]);
  const lines = stdout.replace(/\r?\n$/, "").split(/\r?\n/);
  const [commitId, rawTime, ...subject] = lines;
  const committedAt = new Date(rawTime ?? "");
  if (
    commitId === undefined ||
    !/^[0-9a-f]{40}$/.test(commitId) ||
    Number.isNaN(committedAt.getTime())
  ) {
    throw new Error(`最新提交读不出来：git log 的前两行是 ${JSON.stringify(lines.slice(0, 2))}`);
  }
  return { commitId, committedAt: committedAt.toISOString(), subject: subject.join("\n") };
}
