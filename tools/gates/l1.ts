// L1, tens of seconds: type check and unit tests. Must pass before opening a pull request.
import { runGate } from "./run.ts";

process.exitCode = await runGate("L1", "十秒级：类型检查、单元测试", [
  { name: "typecheck", command: "pnpm exec turbo run typecheck", budgetMs: 15000 },
  { name: "unit", command: "pnpm exec turbo run test", budgetMs: 15000 },
  { name: "tools", command: "pnpm run typecheck:root", budgetMs: 5000 },
]);
