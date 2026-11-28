import { mkdir } from "node:fs/promises";

/**
 * 工程仓库的根目录不在就建出来；建不出来就抛，启动到此为止（规格 P-23）。
 * 旧系统的根目录不在时清单静默为空，谁也看不出哪里不对。这里排在连库之前：目录都建不出来，
 * 就不必再去动数据目录。
 */
export async function ensureProjectsRoot(root: string): Promise<void> {
  try {
    await mkdir(root, { recursive: true });
  } catch (err) {
    // 点名是哪一项配的：Node 只报路径上出问题的那一段（比如压在上面的那个普通文件），不说它是哪个配置项来的。
    throw new Error(`工程仓库的根目录建不出来（PROJECTS_ROOT=${root}）`, { cause: err });
  }
}
