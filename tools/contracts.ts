// Regenerate the contract artifacts (OpenAPI document, then the typed client).
// With --check, also fail when what is committed is stale (the L2 gate, task card: contract consistency).
//
//   pnpm contracts              regenerate
//   pnpm contracts -- --check   regenerate and compare with HEAD
//
// Exit code: 0 ok, 1 stale or failed.
import { spawnSync } from "node:child_process";

const check = process.argv.includes("--check");

function run(command: string): number {
  return spawnSync(command, { stdio: "inherit", shell: true }).status ?? 1;
}

if (run("pnpm --filter @nexus/api contracts") !== 0) process.exit(1);
if (run("pnpm --filter @nexus/api-client generate") !== 0) process.exit(1);

if (check) {
  const diff = spawnSync("git diff --exit-code --stat HEAD -- packages/api-client", {
    stdio: "inherit",
    shell: true,
  });
  if (diff.status !== 0) {
    console.log("\n契约产物过期了：改了路由声明就要跑 pnpm contracts，并把生成物一起提交。");
    process.exit(1);
  }
  console.log("契约产物与代码一致");
}
