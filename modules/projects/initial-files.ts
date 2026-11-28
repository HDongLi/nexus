/**
 * 初始提交恰好这三个文件（规格 P-17）。
 *
 * 平台建的仓库是给智能体干活的，所以有一个给它的入口；别的都不放：不放钩子，不放工程的配置文件，
 * 不放任务，不占端口。旧系统另写了配置文件、两个钩子、一个端口、一条脚手架任务，那是这家单位的样子
 * （规格「明确不做的」）。`.gitignore` 是编排者 2026-11-27 加的：没有它，第一次提交就容易把依赖目录、
 * 口令文件、日志提进去。它只列跟技术栈无关的三类，`node_modules` 这类由工程自己追加。
 */

/** 默认分支。建仓和读最新提交都用它，名字只写在这里（规格 P-18）。 */
export const DEFAULT_BRANCH = "main";

export const INITIAL_FILES = ["README.md", "AGENTS.md", ".gitignore"] as const;

export interface InitialFile {
  path: string;
  content: string;
}

const GITIGNORE = `# 操作系统的杂物
.DS_Store
Thumbs.db
Desktop.ini

# 存口令的环境变量文件；示例放行
.env
.env.*
!.env.example

# 日志
*.log
`;

/** 工程名：有显示名用显示名，没有用短名（规格 P-17）。 */
export function projectTitle(names: { slug: string; displayName: string }): string {
  return names.displayName === "" ? names.slug : names.displayName;
}

export function initialFiles(title: string): InitialFile[] {
  return [
    { path: "README.md", content: `# ${title}\n` },
    {
      path: "AGENTS.md",
      content:
        `# ${title}\n\n` +
        `这个仓库由平台新建，默认分支是 \`${DEFAULT_BRANCH}\`。` +
        "这一份是给在本仓库工作的智能体看的入口。\n",
    },
    { path: ".gitignore", content: GITIGNORE },
  ];
}
