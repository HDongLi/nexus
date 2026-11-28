// L0, seconds: format, lint, dependency direction, compiler placement, blocking calls, task scope.
// Must pass before a commit.
import { runGate } from "./run.ts";

process.exitCode = await runGate("L0", "秒级：格式、lint、依赖方向、任务范围", [
  { name: "format", command: "pnpm exec oxfmt --check .", budgetMs: 3000 },
  { name: "lint", command: "pnpm exec oxlint .", budgetMs: 3000 },
  {
    name: "arch",
    command: "node tools/gates/arch.ts",
    // dependency-cruiser 全仓扫一遍：三个业务模块后实测 5 秒，3 秒是骨架期的初值（2026-11-29 收口校准）。
    budgetMs: 10000,
  },
  { name: "typescript", command: "node tools/gates/ts-versions.ts", budgetMs: 1000 },
  { name: "blocking", command: "node tools/gates/blocking.ts", budgetMs: 1000 },
  { name: "scope", command: "node tools/gates/scope.ts", budgetMs: 1000 },
]);
