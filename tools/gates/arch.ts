// The architecture gate, in two parts (charter §5.2, claim P8).
// 2026-11-26. Part one is dependency-cruiser's rule check. Part two proves the checker actually
// looked: every source file under apps/, modules/ and packages/ must appear in what it cruised.
//
// The second part exists because of a false green on day one. dependency-cruiser could not load
// a TypeScript compiler (TypeScript 7.0 lacks the API it needs; 7.1 is not released yet), so it
// read none of the .ts files, printed a warning, and exited 0: "no dependency violations found
// (4 modules, 2 dependencies cruised)". A check that silently looks at nothing is worse than no
// check, because everybody believes it.
//
//   node tools/gates/arch.ts
//
// Exit code: 0 ok, 1 a rule was broken or source files were skipped.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const TARGETS = ["apps", "modules", "packages"];
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
/** Directory names that are never source: installed packages, build output, tool caches. */
const SKIP = new Set(["node_modules", "dist", ".turbo"]);
const SHOWN = 12;

interface Violation {
  from: string;
  to: string;
  name?: string;
  rule?: { name?: string; comment?: string };
}
interface Cruise {
  modules: { source: string; dependencies: unknown[] }[];
  summary: {
    violations?: Violation[];
    violationsSeen?: Violation[];
    /** How many errors the checker counted, rule violations or otherwise. */
    error?: number;
  };
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) sourceFiles(path, out);
    } else if (SOURCE.test(entry.name)) {
      out.push(relative(ROOT, path).split("\\").join("/"));
    }
  }
  return out;
}

function list(headline: string, lines: string[]): void {
  console.log(`           ${headline}`);
  for (const line of lines.slice(0, SHOWN)) console.log(`             ${line}`);
  if (lines.length > SHOWN) console.log(`             ……还有 ${lines.length - SHOWN} 个`);
}

const run = spawnSync(
  "pnpm exec depcruise apps modules packages --config packages/config/dependency-cruiser.mjs --output-type json",
  { cwd: ROOT, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

let cruise: Cruise | undefined;
try {
  cruise = JSON.parse(run.stdout) as Cruise;
} catch {
  // 不是 JSON：多半是检查器自己没起来。原样打印它的输出，不替它解释。
}
if (!cruise) {
  console.log(run.stdout.trim());
  console.error(run.stderr.trim());
  console.log("arch       依赖检查器没有给出结果");
  process.exit(1);
}

const cruised = new Set(cruise.modules.map((module) => module.source));
const dependencies = cruise.modules.reduce((sum, module) => sum + module.dependencies.length, 0);
console.log(`arch       巡查 ${cruised.size} 个文件，${dependencies} 条依赖`);

const skipped = TARGETS.flatMap((target) => sourceFiles(join(ROOT, target))).filter(
  (file) => !cruised.has(file),
);
if (skipped.length) {
  list(`漏看了 ${skipped.length} 个源文件（多半是没拿到可用的解析器）：`, skipped);
}
const violations = cruise.summary.violations ?? cruise.summary.violationsSeen ?? [];
if (violations.length) {
  list(
    `违规 ${violations.length} 条：`,
    violations.map((v) => `${v.rule?.name ?? v.name ?? "?"}  ${v.from} -> ${v.to}`),
  );
}
// Errors that are not rule violations (a file it could not read, for instance) only show up
// as a number, so the checker's own output is printed for those.
const otherErrors = (cruise.summary.error ?? 0) - violations.length;
if (otherErrors > 0) {
  console.log(`           另有 ${otherErrors} 个不是规则违规的错误。检查器自己的输出：`);
  console.log(run.stderr.trim());
}
if (!skipped.length && !violations.length && !otherErrors) {
  console.log("           依赖方向合规，没有漏看的文件");
  process.exit(0);
}
process.exit(1);
