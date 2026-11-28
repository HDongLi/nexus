// L1, tens of seconds: type check and unit tests. Must pass before opening a pull request.
import { runGate } from "./run.ts";

process.exitCode = await runGate("L1", "十秒级：类型检查、单元测试", [
  { name: "typecheck", command: "pnpm exec turbo run typecheck", budgetMs: 15000 },
  // 单元套件第 1–3 片后长到三百多条：无缓存实测 23.8 秒，15 秒是骨架期的初值（2026-11-29 收口校准）。
  { name: "unit", command: "pnpm exec turbo run test", budgetMs: 30000 },
  // 工具层自己也有测试：闸的重闸互斥用 Node 自带的测试器（2026-11-27），不为工具层再引一个测试框架。
  {
    name: "tools",
    command: 'node --test "tools/gates/*.test.ts" && pnpm run typecheck:root',
    budgetMs: 10000,
  },
]);
