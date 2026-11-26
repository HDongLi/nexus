// Charter §11 rule 1: nothing blocking on the request path. A synchronous child process, file
// read or HTTP call holds up every other request while it runs. The old repository had 182 of
// them inside an async framework.
// 2026-11-26. The linter in use has no rule for this (oxlint ships no `no-sync`), so it is
// checked here: any call whose name ends in `Sync`, inside a file that runs while a request is
// being served. That catches the fs, child_process and net families in one pattern.
//
//   node tools/gates/blocking.ts
//
// Exit code: 0 ok, 1 a blocking call sits on the request path.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
// Everything a module runs can sit on the request path, helper files included. In the API app
// only the start-up files are left out: main.ts, config.ts, version.ts, listen.ts and scripts/.
// Blocking there delays boot, not requests.
const REQUEST_PATH =
  /^(?:modules\/[^/]+\/(?!.*\.test\.ts$).+\.ts|apps\/api\/src\/(?!scripts\/|.*\.test\.ts$)(?!main\.ts$|config\.ts$|version\.ts$|listen\.ts$).+\.ts)$/;
const SYNCHRONOUS_CALL = /\b([A-Za-z_$][\w$]*Sync)\s*\(/g;
const SKIP = new Set(["node_modules", "dist", ".turbo"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) sourceFiles(path, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(relative(ROOT, path).split("\\").join("/"));
    }
  }
  return out;
}

const offenders: string[] = [];
for (const file of ["modules", "apps/api/src"].flatMap((dir) => sourceFiles(join(ROOT, dir)))) {
  if (!REQUEST_PATH.test(file)) continue;
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const match of line.matchAll(SYNCHRONOUS_CALL)) {
      offenders.push(`${file}:${i + 1}  ${match[1] ?? "?"}`);
    }
  });
}

if (offenders.length) {
  console.log(`blocking   请求路径上有 ${offenders.length} 处同步调用：`);
  for (const line of offenders) console.log(`           ${line}`);
  console.log(
    "           同步子进程、同步文件、同步 HTTP 会挡住别的请求（任务书实弹条款 1）。改成异步的。",
  );
} else {
  console.log("blocking   请求路径上没有同步调用");
}
process.exitCode = offenders.length ? 1 : 0;
