// L2, minutes: integration tests, contract consistency, migration replay. Must pass before merging.
import { runGate } from "./run.ts";

process.exitCode = await runGate("L2", "分钟级：集成测试、契约一致性、迁移可重放", [
  // 集成套件第 3 片后 167 条：无缓存实测 119 秒、审查实弹 126 秒，120 秒的初值贴线常报超（2026-11-29 收口校准）。
  { name: "integration", command: "pnpm exec turbo run test:integration", budgetMs: 180000 },
  { name: "contracts", command: "node tools/contracts.ts --check", budgetMs: 30000 },
  { name: "migrations", command: "pnpm exec turbo run migrate:check", budgetMs: 60000 },
]);
