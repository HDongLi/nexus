// L3, before a release: end-to-end through the real entry shape, a real Postgres, performance budgets.
import { runGate } from "./run.ts";

process.exitCode = await runGate("L3", "发布前：端到端、真库复跑、性能预算", [
  { name: "e2e", command: "pnpm exec turbo run e2e" },
]);
