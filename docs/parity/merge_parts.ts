// Merge route-classification parts into the parity tables.
// 2026-11-26: written in TypeScript and run straight by Node, because the charter
// (§11 rule 16) says scripts are Node from now on. Nothing here touches the old repo.
//
//   node docs/parity/merge_parts.ts                    validate, then write outputs (partial coverage allowed)
//   node docs/parity/merge_parts.ts --check            validate only, write nothing
//   node docs/parity/merge_parts.ts --strict           every route of the raw tables must have a verdict
//   node docs/parity/merge_parts.ts --apply-defaults   unanswered questions take their default option
//
// Exit code: 0 ok, 1 validation problems (nothing written), 2 environment error.
// The work is split across lib/: model (vocabulary), csv, load (reading and rules), render (outputs).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkTopics, load, resolve } from "./lib/load.ts";
import { DESTS, RAW_FILES, countBy, isOpen } from "./lib/model.ts";
import { writeDecisions, writeRoutes, writeWorkers } from "./lib/render.ts";

const HERE = import.meta.dirname;
const FLAGS = ["--check", "--strict", "--apply-defaults"];

function main(): number {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a) => !FLAGS.includes(a));
  if (unknown.length) {
    console.error(`未知参数：${unknown.join(" ")}`);
    return 2;
  }
  if (!existsSync(join(HERE, "routes.raw.csv"))) {
    console.error("缺 routes.raw.csv");
    return 2;
  }
  const problems: string[] = [];
  const { raw, tableOf, rows, workers, batchesIn } = load(problems);
  checkTopics(rows, problems);
  resolve(rows, problems, argv.includes("--apply-defaults"));
  const have = new Set(rows.map((r) => r.rid));
  const missing = [...raw.keys()].filter((rid) => !have.has(rid));
  if (argv.includes("--strict") && missing.length) {
    const shown = missing.slice(0, 20).join(" ");
    problems.push(
      `--strict：还有 ${missing.length} 条没有结论：${shown}${missing.length > 20 ? " …" : ""}`,
    );
  }

  const byDest = countBy(rows, (r) => r.dest);
  const open = rows.filter(isOpen);
  const perTable = RAW_FILES.map((n) => {
    const total = [...tableOf.values()].filter((t) => t === n).length;
    return `${n} ${rows.filter((r) => tableOf.get(r.rid) === n).length}/${total}`;
  }).join("  ");
  console.log(`batches in: ${batchesIn.join(", ") || "none"}`);
  console.log(`covered: ${rows.length} / ${raw.size}   missing: ${missing.length}   (${perTable})`);
  console.log(`dest: ${DESTS.map((d) => `${d} ${byDest[d] ?? 0}`).join(", ")}`);
  const topics = new Set(open.map((r) => r.question?.topic || r.rid)).size;
  const unclear = open.filter((r) => r.dest === "unclear").length;
  console.log(
    `questions: open ${open.length} routes in ${topics} topics (unclear ${unclear}, low ${open.length - unclear}), answered ${rows.filter((r) => r.destSrc === "answer").length}, by-default ${rows.filter((r) => r.destSrc === "default").length}`,
  );
  console.log(`workers: ${workers.length}`);
  console.log(`problems: ${problems.length}`);
  for (const p of problems.slice(0, 60)) console.log(`  - ${p}`);
  if (problems.length) {
    console.log("not writing: fix the problems first");
    return 1;
  }
  if (argv.includes("--check")) return 0;
  writeRoutes(rows, raw, join(HERE, "routes.csv"));
  writeDecisions(rows, raw, tableOf, batchesIn, join(HERE, "decisions.md"));
  writeWorkers(workers, join(HERE, "workers.md"));
  console.log("wrote routes.csv, decisions.md, workers.md");
  return 0;
}

process.exitCode = main();
