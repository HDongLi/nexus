// `pnpm new:module <name> [--title <一句话>]`: scaffold a module from the files in template/.
// 2026-11-26. The template is real files with placeholders, not code assembled from strings in
// here: what a new module looks like is what you see in template/. This script fills the
// placeholders, links the package, and runs the new module's own type check and tests, so a
// module is green the moment it exists.
//
//   name   lower-case ASCII: letters, digits, hyphens (issue-tracker)
//   title  the one-line description shown to people; defaults to the name
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function parse(args: string[]): { name: string; title: string } {
  let title: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--title") title = args[++i];
    else positional.push(args[i] ?? "");
  }
  return { name: positional[0] ?? "", title: title ?? positional[0] ?? "" };
}

function run(label: string, command: string): boolean {
  console.log(`\n== ${label}`);
  return spawnSync(command, { stdio: "inherit", shell: true }).status === 0;
}

function main(): number {
  const { name, title } = parse(process.argv.slice(2));
  if (!NAME_PATTERN.test(name)) {
    console.error("用法：pnpm new:module <名字> [--title <一句话>]");
    console.error("名字用小写字母、数字和连字符，例如 issue-tracker");
    return 2;
  }
  const target = join(HERE, "..", "modules", name);
  if (existsSync(target)) {
    console.error(`modules/${name} 已经存在`);
    return 1;
  }

  // issue-tracker → issueTracker / IssueTracker: for identifiers.
  const camel = name
    .split("-")
    .map((part, i) => (i === 0 ? part : `${(part[0] ?? "").toUpperCase()}${part.slice(1)}`))
    .join("");
  const pascal = `${(camel[0] ?? "").toUpperCase()}${camel.slice(1)}`;
  const fill = (text: string): string =>
    text
      .replaceAll("{{name}}", name)
      .replaceAll("{{camel}}", camel)
      .replaceAll("{{Name}}", pascal)
      .replaceAll("{{title}}", title)
      .replaceAll("{{date}}", new Date().toISOString().slice(0, 10));

  const copy = (from: string, to: string): void => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const source = join(from, entry.name);
      const out = join(to, entry.name.replace("_module", name).replace(/\.tmpl$/, ""));
      if (entry.isDirectory()) {
        mkdirSync(out, { recursive: true });
        copy(source, out);
      } else {
        writeFileSync(out, fill(readFileSync(source, "utf8")));
      }
    }
  };
  mkdirSync(target, { recursive: true });
  copy(join(HERE, "new-module", "template"), target);
  console.log(`模块已生成：modules/${name}`);

  // The name passed the pattern above, so it is safe inside a command line.
  const pkg = `@nexus/${name}`;
  const ok =
    run("链接工作区包", "pnpm install") &&
    run("类型检查", `pnpm --filter ${pkg} typecheck`) &&
    run("单元测试", `pnpm --filter ${pkg} test`);
  if (!ok) {
    console.error("\n生成的模块没有过它自己的检查。模板可能和基础包脱节了，先修 template/。");
    return 1;
  }

  console.log("\n模块已是绿的。把它接进应用还有下面几步，脚手架不替你改应用的代码：");
  console.log(
    `  1. apps/api/package.json 的 dependencies 加 "${pkg}": "workspace:*"，再跑 pnpm install`,
  );
  console.log(`  2. apps/api/src/contract-sources.ts 的 contractSources() 加 ${camel}Contract`);
  console.log(
    `  3. apps/api/src/main.ts 里 create${pascal}Module(...)，把 bindings 交给 createApp 的 modules`,
  );
  console.log("  4. pnpm contracts：契约产物重新生成，和代码一起提交");
  console.log("  5. 把 module.md 填实：职责、事件、表、不做什么");
  return 0;
}

process.exitCode = main();
