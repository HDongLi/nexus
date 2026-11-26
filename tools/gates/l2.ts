// L2, minutes: integration tests, contract consistency, migration replay. Must pass before merging.
import { runGate } from "./run.ts";

process.exitCode = await runGate("L2", "分钟级：集成测试、契约一致性、迁移可重放", [
  { name: "integration", command: "pnpm exec turbo run test:integration", budgetMs: 120000 },
  { name: "contracts", command: "node tools/contracts.ts --check", budgetMs: 30000 },
  { name: "migrations", command: "pnpm exec turbo run migrate:check", budgetMs: 60000 },
]);
