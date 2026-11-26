// The three generated files: routes.csv (the merged table), decisions.md (what the owner must decide),
// and workers.md (what runs outside of routes).
import { writeFileSync } from "node:fs";
import { csvField } from "./csv.ts";
import {
  BATCH_FILES,
  CONFS,
  DEST_LABEL,
  DESTS,
  FILE_BATCH,
  LETTERS,
  RAW_FILES,
  countBy,
  isOpen,
  md,
  topicOf,
  today,
  type Row,
  type Worker,
} from "./model.ts";

export function writeRoutes(
  rows: Row[],
  raw: Map<string, Record<string, string>>,
  path: string,
): void {
  const head = [
    "rid",
    "batch",
    "services",
    "file",
    "line",
    "method",
    "path",
    "handler",
    "summary",
    "actor",
    "callers_evidence",
    "deps_stores",
    "deps_external",
    "side_effect",
    "dest",
    "dest_src",
    "confidence",
    "reason",
    "decision",
    "question_topic",
    "question_q",
  ];
  const lines = [head.join(",")];
  for (const row of [...rows].sort((a, b) => a.rid.localeCompare(b.rid))) {
    const r = raw.get(row.rid) ?? {};
    lines.push(
      [
        row.rid,
        row.batch,
        r.services ?? "",
        r.file ?? "",
        r.line ?? "",
        r.method ?? "",
        r.path ?? "",
        r.handler ?? "",
        row.summary,
        row.actor,
        row.callers,
        row.stores.join(" | "),
        row.external.join(" | "),
        row.sideEffect,
        row.dest,
        row.destSrc,
        row.confidence,
        row.reason,
        row.decision,
        row.question?.topic ?? "",
        row.question?.q ?? "",
      ]
        .map(csvField)
        .join(","),
    );
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

export function writeDecisions(
  rows: Row[],
  raw: Map<string, Record<string, string>>,
  tableOf: Map<string, string>,
  batchesIn: string[],
  path: string,
): void {
  const open = rows.filter(isOpen);
  // Every questioned route, grouped by topic. A topic is shown when at least one of its routes is
  // open; the others are routes that follow that decision.
  const groups = new Map<string, Row[]>();
  for (const r of rows)
    if (r.question) groups.set(topicOf(r), [...(groups.get(topicOf(r)) ?? []), r]);
  const topics = new Map([...groups].filter(([, rs]) => rs.some(isOpen)));
  const followers = [...topics.values()].reduce((n, rs) => n + rs.length, 0) - open.length;
  const aside = rows.filter((r) => r.question && !topics.has(topicOf(r)));
  const answered = rows.filter((r) => r.destSrc === "answer");
  const byDefault = rows.filter((r) => r.destSrc === "default");
  const byDest = countBy(rows, (r) => r.dest);
  const tag = (row: Row): string => {
    const r = raw.get(row.rid) ?? {};
    return `${r.method ?? ""} ${r.path ?? ""}`;
  };
  const tableCount = (name: string): number =>
    [...tableOf.values()].filter((t) => t === name).length;
  const covered = (name: string): number => rows.filter((r) => tableOf.get(r.rid) === name).length;

  const out: string[] = ["# 裁决清单", "", "| 项 | 内容 |", "|---|---|"];
  out.push(`| 日期 | ${today()} |`);
  out.push("| 来源 | `merge_parts.ts` 生成，不要手改。答复登记进 `answers.json` 后重新生成 |");
  out.push("| 怎么答 | 一行一题：`R042 a`。不答的按默认项走（任务书 §6.8） |");
  const coverage = RAW_FILES.filter((n) => tableCount(n) > 0)
    .map((n) => `${n === "routes.raw.csv" ? "服务端" : "本机端"} ${covered(n)} / ${tableCount(n)}`)
    .join("；");
  out.push(`| 已到批次 | ${batchesIn.join("、") || "无"}（${coverage} 条） |`);
  out.push(
    `| 待你裁决 | ${topics.size} 题：判不准的 ${open.length} 条路由${followers ? `，另有跟着走的 ${followers} 条` : ""} |`,
  );
  out.push(`| 已有答复 | ${answered.length} 条 |`);
  out.push(`| 按默认项走 | ${byDefault.length} 条 |`, "");
  out.push("## 归宿总览", "", "| 归宿 | 条数 |", "|---|---|");
  for (const d of DESTS) out.push(`| ${DEST_LABEL[d]}（${d}） | ${byDest[d] ?? 0} |`);
  out.push(
    "",
    "| 批次 | 进内核 | 定制包 | 工具 | 退役 | 判不准 | 未到 |",
    "|---|---|---|---|---|---|---|",
  );
  const all = [...raw.values()];
  for (const b of Object.keys(BATCH_FILES)) {
    const size = all.filter((r) => FILE_BATCH.get(r.file ?? "") === b).length;
    const c = countBy(
      rows.filter((r) => r.batch === b),
      (r) => r.dest,
    );
    out.push(
      `| ${b} | ${c.kernel ?? 0} | ${c.m ?? 0} | ${c.tool ?? 0} | ${c.retire ?? 0} | ${c.unclear ?? 0} | ${size - Object.values(c).reduce((s, n) => s + n, 0)} |`,
    );
  }
  out.push("", "## 待裁决", "");
  if (!open.length) out.push("没有待裁决的条目。");
  for (const b of Object.keys(BATCH_FILES)) {
    const mine = open.filter((r) => r.batch === b);
    out.push(...renderBatch(mine, groups, tag));
  }
  if (answered.length || byDefault.length) {
    out.push("## 已裁决", "", "| 路由 | 接口 | 所选 | 归宿 | 来源 |", "|---|---|---|---|---|");
    for (const row of [...answered, ...byDefault]) {
      const from = row.destSrc === "answer" ? "你的答复" : "按默认项";
      out.push(
        `| ${row.rid} | ${md(tag(row))} | ${md(row.decision)} | ${DEST_LABEL[row.dest]} | ${from} |`,
      );
    }
    out.push("");
  }
  if (aside.length) {
    out.push("## 顺带的疑问", "", "这些已有归宿，清点的人只是留了个疑问。可以不看。", "");
    for (const row of aside) {
      out.push(
        `- **${row.rid} ${tag(row)}**（初判 ${DEST_LABEL[row.dest]}）：${row.question?.q ?? ""}`,
      );
    }
    out.push("");
  }
  writeFileSync(path, `${out.join("\n")}\n`, "utf8");
}

function renderBatch(mine: Row[], groups: Map<string, Row[]>, tag: (row: Row) => string): string[] {
  if (!mine.length) return [];
  const out = [`### ${mine[0]?.batch ?? ""}`, ""];
  const shown = new Set<string>();
  for (const row of mine) {
    const key = topicOf(row);
    if (shown.has(key)) continue;
    shown.add(key);
    const all = [...(groups.get(key) ?? [row])].sort((x, y) => x.rid.localeCompare(y.rid));
    const head = lead(all);
    const q = head.question;
    if (!q) continue;
    out.push(`#### ${key}${all.length > 1 ? `（影响 ${all.length} 条）` : ""}`, "");
    if (all.length > 1) {
      for (const r of all) out.push(`- ${r.rid} ${tag(r)}：${r.summary}`);
      out.push("");
    }
    out.push(`- 做什么：${head.summary}`);
    out.push(`- 谁在用：${head.actor}`);
    out.push(`- 证据：${head.callers}`);
    out.push(
      `- 依赖：数据 ${head.stores.join("、") || "无"}；外部 ${head.external.join("、") || "无"}`,
    );
    out.push(`- 初判：${DEST_LABEL[head.dest]}（把握 ${head.confidence}）`);
    out.push(`- 问：${q.q}`);
    q.options.forEach((o, i) => {
      out.push(`  - ${LETTERS[i]}. ${o.label}${i === q.def ? " ← 默认" : ""}`);
    });
    out.push(`- 默认项的依据：${q.evidence}`, "");
  }
  return out;
}

// The topic's lead route is the undecided one: open first, then lowest confidence, then the most
// fully spelled-out question.
function lead(rs: Row[]): Row {
  const confRank = (c: string): number => CONFS.indexOf(c);
  const [first] = rs;
  if (!first) throw new Error("议题里一条路由都没有");
  return (
    [...rs].sort(
      (a, b) =>
        Number(isOpen(b)) - Number(isOpen(a)) ||
        Number(a.dest === "unclear") - Number(b.dest === "unclear") ||
        confRank(a.confidence) - confRank(b.confidence) ||
        (b.question?.q.length ?? 0) - (a.question?.q.length ?? 0) ||
        a.rid.localeCompare(b.rid),
    )[0] ?? first
  );
}

export function writeWorkers(workers: Worker[], path: string): void {
  const out = [
    "# 非路由能力清单",
    "",
    "| 项 | 内容 |",
    "|---|---|",
    `| 日期 | ${today()} |`,
    "| 来源 | 各批次 `_meta.workers`，`merge_parts.ts` 生成 |",
    "",
    "路由之外还在跑的东西：后台循环、定时器、启动钩子。写规格时逐个定归宿。",
    "",
    "| 批次 | 名称 | 文件 | 做什么 |",
    "|---|---|---|---|",
  ];
  for (const w of workers) out.push(`| ${w.batch} | ${md(w.name)} | ${w.file} | ${md(w.what)} |`);
  out.push("");
  writeFileSync(path, `${out.join("\n")}\n`, "utf8");
}
