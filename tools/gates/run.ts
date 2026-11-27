// Shared runner for the four gate levels (charter §6.5).
// 2026-11-26: one place that runs commands in order, times each, and prints one table.
import { spawn } from "node:child_process";
import { withHeavyGateLock } from "./lock.ts";

export interface Step {
  name: string;
  /** A full command line run through a shell. Always a constant string here, never built from untrusted input. */
  command: string;
  /** The charter's budget for this step. Reported always; enforced only with GATE_BUDGETS=strict. */
  budgetMs?: number;
}

interface Row {
  name: string;
  ms: number;
  budget: number | undefined;
  ok: boolean;
}

/** 要排队的闸：分钟级的两道，吃满处理器的那种。L0、L1 是秒级的，并排跑无妨。 */
const EXCLUSIVE_LEVELS = new Set(["L2", "L3"]);

export async function runGate(level: string, title: string, steps: Step[]): Promise<number> {
  const run = (): Promise<number> => runSteps(level, title, steps);
  // 只有一路在跑的场合（持续集成里的一个任务）可以关掉排队：NEXUS_GATE_LOCK=off。
  if (!EXCLUSIVE_LEVELS.has(level) || process.env.NEXUS_GATE_LOCK === "off") return run();
  try {
    // 2026-11-27：同一台机器上几个工作区、几个代理同时跑重闸会互相拖垮（集成测试死在准备阶段的超时上），
    // 所以重闸排队。等的时间不算在步骤的预算里：拿锁发生在第一步之前。
    return await withHeavyGateLock(level, run);
  } catch (error) {
    console.log(`\n== ${level} 没跑：${(error as Error).message}`);
    return 1;
  }
}

async function runSteps(level: string, title: string, steps: Step[]): Promise<number> {
  console.log(`\n== ${level} ${title}`);
  const started = Date.now();
  const rows: Row[] = [];
  for (const step of steps) {
    const t0 = Date.now();
    const ok = (await exec(step.command)) === 0;
    rows.push({ name: step.name, ms: Date.now() - t0, budget: step.budgetMs, ok });
    if (!ok) return report(level, rows, started, "一步不过，后面不再跑");
  }
  return report(level, rows, started, "全绿");
}

function exec(command: string): Promise<number> {
  return new Promise((resolve) => {
    // Turborepo 首次运行会提示遥测；这里直接关掉，闸的输出里不留这种噪音。
    const child = spawn(command, {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
    });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function report(level: string, rows: Row[], started: number, verdict: string): number {
  const total = Date.now() - started;
  for (const r of rows) {
    const over = r.budget !== undefined && r.ms > r.budget;
    console.log(
      `   ${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(10)} ${(r.ms / 1000).toFixed(2)}s${
        r.budget === undefined ? "" : over ? `  (超预算 ${(r.budget / 1000).toFixed(0)}s)` : ""
      }`,
    );
  }
  console.log(`== ${level} ${verdict}：${(total / 1000).toFixed(2)}s`);
  const allOk = rows.every((r) => r.ok);
  // 预算先只报不拦（任务书 §6.5：初值，D1 校准后进 CI）。GATE_BUDGETS=strict 时超了也算不过。
  const overBudget = rows.some((r) => r.budget !== undefined && r.ms > r.budget);
  if (allOk && overBudget && process.env.GATE_BUDGETS === "strict") {
    console.log(`== ${level} 超出预算`);
    return 1;
  }
  return allOk ? 0 : 1;
}
