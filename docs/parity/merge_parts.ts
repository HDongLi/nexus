// Merge route-classification parts into the parity tables.
// 2026-11-26: written in TypeScript and run straight by Node, because the charter
// (§11 rule 16) says scripts are Node from now on. This file never touches the old repo.
//
//   node docs/parity/merge_parts.ts                    validate, then write outputs (partial coverage allowed)
//   node docs/parity/merge_parts.ts --check            validate only, write nothing
//   node docs/parity/merge_parts.ts --strict           every route of the raw table must have a verdict
//   node docs/parity/merge_parts.ts --apply-defaults   unanswered questions take their default option
//
// Exit code: 0 ok, 1 validation problems (nothing written), 2 environment error.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;

const DESTS = ["kernel", "m", "tool", "retire", "unclear"];
const CONFS = ["high", "mid", "low"];
const SIDE = ["read", "write", "exec", "network"];
const LETTERS = "abcd";
const FLAGS = ["--check", "--strict", "--apply-defaults"];

const BATCH_FILES: Record<string, string[]> = {
  "a-prod": ["prod/app.py"],
  "b-core": ["cyberneticscore/app.py", "cyberneticscore/observer.py"],
  "c-platform": [
    "dev/routers/platform_routes.py",
    "dev/routers/datamap_routes.py",
    "dev/routers/tick_routes.py",
    "dev/routers/observer_routes.py",
    "dev/routers/dsh_routes.py",
  ],
  "d-devflow": [
    "dev/routers/release_routes.py",
    "dev/routers/ai_routes.py",
    "dev/routers/agent_routes.py",
    "dev/routers/queue_routes.py",
    "dev/routers/sandbox_routes.py",
    "dev/routers/feedback_routes.py",
  ],
  "e-data": [
    "dev/routers/data_routes.py",
    "dev/routers/datajobs_routes.py",
    "dev/routers/docs_elfinder.py",
    "dev/routers/projects.py",
    "dev/routers/pages.py",
  ],
  "f-identity": ["identity/registry.py", "identity/oracle.py", "prod/ai_gateway.py", "prod/client_update.py"],
  // The local client: its routes all retire (charter D-2); what is classified is the capability.
  "g-client": ["main.py"],
};
// Raw tables, in report order. The first is the charter's 272; the second is the local client.
const RAW_FILES = ["routes.raw.csv", "client.raw.csv"];
const FILE_BATCH = new Map<string, string>(
  Object.entries(BATCH_FILES).flatMap(([b, fs]) => fs.map((f) => [f, b])),
);
const DEST_LABEL: Record<string, string> = {
  kernel: "进内核",
  m: "进定制包",
  tool: "作为工具重建",
  retire: "退役",
  unclear: "判不准",
};
// Addresses and personal home directories are caught by pattern. The machine, account and
// organization names of the old deployment come from a local word list that is deliberately
// not committed (docs/parity/sensitive-words.txt, one word per line): writing them into this
// file would publish the very names it keeps out. Writers say 开发机 / 生产机 / 本机 instead.
const SENSITIVE_PATTERN = /\/home\/\w+\/|\b(?!(?:127|0)\.)\d{1,3}(?:\.\d{1,3}){3}\b/;
function sensitiveRegex(): RegExp {
  const path = join(HERE, "sensitive-words.txt");
  if (!existsSync(path)) return SENSITIVE_PATTERN;
  const words = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
  if (!words.length) return SENSITIVE_PATTERN;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`${SENSITIVE_PATTERN.source}|${escaped.join("|")}`, "i");
}
const SENSITIVE = sensitiveRegex();
const textOf = (row: Row): string =>
  [
    row.summary, row.actor, row.callers, row.reason, ...row.stores, ...row.external,
    row.question?.q ?? "", row.question?.evidence ?? "", ...(row.question?.options.map((o) => o.label) ?? []),
  ].join("\n");

// Words in an option label that name a destination. Exactly one hit = the option's destination.
const DEST_HINT: Record<string, string[]> = {
  kernel: ["kernel", "内核"],
  m: ["定制"],
  tool: ["tool", "工具"],
  retire: ["retire", "退役", "不进新版"],
};

interface Option {
  label: string;
  dest: string;
}
interface Question {
  q: string;
  options: Option[];
  def: number;
  evidence: string;
  // Several routes that share one decision carry the same topic; the product owner answers once.
  topic: string;
}
interface Row {
  rid: string;
  batch: string;
  where: string;
  summary: string;
  actor: string;
  callers: string;
  sideEffect: string;
  reason: string;
  stores: string[];
  external: string[];
  dest: string;
  confidence: string;
  question: Question | null;
  destSrc: string;
  decision: string;
}
interface Worker {
  batch: string;
  name: string;
  file: string;
  what: string;
}
interface Loaded {
  raw: Map<string, Record<string, string>>;
  tableOf: Map<string, string>;
  rows: Row[];
  workers: Worker[];
  batchesIn: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const flat = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const md = (s: string): string => s.replace(/\|/g, "\\|");
const isOpen = (r: Row): boolean => r.dest === "unclear" || r.confidence === "low";
const countBy = (rows: Row[], key: (r: Row) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1;
  return out;
};
const today = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function asList(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return v.trim() ? [flat(v)] : [];
  if (Array.isArray(v)) return v.map(flat).filter(Boolean);
  return [JSON.stringify(v)];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const csvField = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function destOfLabel(label: string): string {
  const s = label.toLowerCase();
  const hits = Object.entries(DEST_HINT).filter(([, hints]) => hints.some((h) => s.includes(h)));
  return hits.length === 1 ? hits[0][0] : "";
}

function load(problems: string[]): Loaded {
  const raw = new Map<string, Record<string, string>>();
  const tableOf = new Map<string, string>();
  for (const name of RAW_FILES) {
    const path = join(HERE, name);
    if (!existsSync(path)) continue;
    const table = parseCsv(readFileSync(path, "utf8"));
    const head = table[0] ?? [];
    for (const cells of table.slice(1)) {
      if (cells.length === 1 && cells[0] === "") continue;
      const row: Record<string, string> = {};
      head.forEach((h, i) => {
        row[h] = cells[i] ?? "";
      });
      raw.set(row.rid ?? "", row);
      tableOf.set(row.rid ?? "", name);
    }
  }

  const rows: Row[] = [];
  const workers: Worker[] = [];
  const batchesIn: string[] = [];
  const seen = new Map<string, string>();

  const optNorm = (o: unknown): Option => {
    if (isObj(o)) {
      return {
        label: flat(o.label ?? o.text ?? o.title),
        dest: DESTS.includes(String(o.dest)) ? String(o.dest) : "",
      };
    }
    const label = flat(o);
    return { label, dest: destOfLabel(label) };
  };
  const qNorm = (q: unknown, where: string): Question | null => {
    if (q === null || q === undefined) return null;
    if (!isObj(q)) {
      problems.push(`${where}: question 不是对象`);
      return null;
    }
    const opts = q.options;
    if (!Array.isArray(opts) || opts.length < 2 || opts.length > 4) {
      problems.push(`${where}: question.options 须为 2 到 4 项`);
      return null;
    }
    const def = q.default;
    if (!isInt(def) || def < 0 || def >= opts.length) {
      problems.push(`${where}: question.default 须是选项下标`);
      return null;
    }
    return { q: flat(q.q), options: opts.map(optNorm), def, evidence: flat(q.evidence), topic: flat(q.topic) };
  };

  for (const batch of Object.keys(BATCH_FILES)) {
    const partPath = join(HERE, "parts", `${batch}.jsonl`);
    if (!existsSync(partPath)) continue;
    batchesIn.push(batch);
    const text = readFileSync(partPath, "utf8").replace(/^﻿/, "");
    const objs: [number, unknown][] = [];
    if (text.trimStart().startsWith("[")) {
      try {
        for (const o of JSON.parse(text) as unknown[]) objs.push([0, o]);
      } catch (e) {
        problems.push(`${batch}.jsonl: 不是合法的 JSON（${String(e)}）`);
        continue;
      }
    } else {
      text.split("\n").forEach((line, i) => {
        if (!line.trim()) return;
        try {
          objs.push([i + 1, JSON.parse(line)]);
        } catch (e) {
          problems.push(`${batch}.jsonl:${i + 1}: 不是合法 JSON（${String(e)}）`);
        }
      });
    }
    for (const [n, obj] of objs) {
      const where = `${batch}.jsonl:${n}`;
      if (!isObj(obj)) {
        problems.push(`${where}: 不是对象`);
        continue;
      }
      if ("_meta" in obj) {
        const meta = obj._meta;
        if (isObj(meta) && Array.isArray(meta.workers)) {
          for (const w of meta.workers) {
            if (isObj(w)) {
              workers.push({ batch, name: flat(w.name), file: flat(w.file), what: flat(w.what) });
            }
          }
        }
        continue;
      }
      const rid = flat(obj.rid);
      const r = raw.get(rid);
      if (!r) {
        problems.push(`${where}: rid ${rid || "(空)"} 不在底表里`);
        continue;
      }
      const owner = FILE_BATCH.get(r.file ?? "");
      if (owner !== batch) problems.push(`${where}: ${rid} 属于批次 ${owner ?? "?"}，不是 ${batch}`);
      if (seen.has(rid)) {
        problems.push(`${where}: ${rid} 重复，先见于 ${seen.get(rid)}`);
        continue;
      }
      seen.set(rid, where);

      const need = (f: string): string => {
        const v = obj[f];
        if (typeof v !== "string" || !v.trim()) problems.push(`${where}: 缺字段 ${f}`);
        return flat(v);
      };
      const row: Row = {
        rid, batch, where,
        summary: need("summary"), actor: need("actor"), callers: need("callers_evidence"),
        sideEffect: need("side_effect"), reason: need("reason"),
        stores: [], external: [],
        dest: "unclear", confidence: "low", question: null,
        destSrc: "agent", decision: "",
      };
      if (DESTS.includes(String(obj.dest))) row.dest = String(obj.dest);
      else problems.push(`${where}: dest 须是 ${DESTS.join(" / ")}`);
      if (CONFS.includes(String(obj.confidence))) row.confidence = String(obj.confidence);
      else problems.push(`${where}: confidence 须是 ${CONFS.join(" / ")}`);
      const bad = row.sideEffect.toLowerCase().split(/[+,，/|]+/).filter((t) => t && !SIDE.includes(t));
      if (bad.length) problems.push(`${where}: side_effect 含未知值 ${bad.join(" ")}`);
      const deps = obj.deps;
      if (!isObj(deps)) problems.push(`${where}: 缺 deps`);
      row.stores = asList(isObj(deps) ? deps.stores : undefined);
      row.external = asList(isObj(deps) ? deps.external : undefined);
      row.question = qNorm(obj.question, where);
      if (isOpen(row) && !row.question) {
        problems.push(`${where}: dest=unclear 或 confidence=low 时必须给 question`);
      }
      rows.push(row);
      const hit = SENSITIVE.exec(textOf(row));
      if (hit) problems.push(`${where}: ${rid} 含内网名或地址「${hit[0]}」，改成「开发机 / 生产机 / 本机」`);
    }
  }
  for (const w of workers) {
    const hit = SENSITIVE.exec([w.name, w.file, w.what].join("\n"));
    if (hit) problems.push(`workers（${w.batch}）${w.name}: 含内网名或地址「${hit[0]}」`);
  }
  return { raw, tableOf, rows, workers, batchesIn };
}

const topicOf = (r: Row): string => r.question?.topic || r.rid;

// Routes sharing a topic must offer the same choice: same option count, same default index.
function checkTopics(rows: Row[], problems: string[]): void {
  const head = new Map<string, Row>();
  for (const r of rows) {
    if (!r.question) continue;
    const first = head.get(topicOf(r));
    if (!first) head.set(topicOf(r), r);
    else if (first.question?.options.length !== r.question.options.length || first.question.def !== r.question.def) {
      problems.push(`${r.where}: ${r.rid} 与 ${first.rid} 同题（${topicOf(r)}），但选项数或默认项不一致`);
    }
  }
}

// Applies answers.json and (optionally) default options. Mutates rows in place.
function resolve(rows: Row[], problems: string[], applyDefaults: boolean): void {
  let answers: unknown = {};
  const ansPath = join(HERE, "answers.json");
  if (existsSync(ansPath)) {
    try {
      answers = JSON.parse(readFileSync(ansPath, "utf8"));
    } catch (e) {
      problems.push(`answers.json: 不是合法的 JSON（${String(e)}）`);
    }
  }
  if (!isObj(answers)) {
    if (existsSync(ansPath)) problems.push("answers.json: 顶层须是对象");
    return;
  }
  const byTopic = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.question) continue;
    byTopic.set(topicOf(r), [...(byTopic.get(topicOf(r)) ?? []), r]);
  }
  for (const key of Object.keys(answers)) {
    if (!byTopic.has(key)) problems.push(`answers.json ${key}: 没有对应的待裁决题`);
  }
  for (const [key, mine] of byTopic) {
    const a = answers[key];
    // A topic with no open route is a side remark: it only moves when answered explicitly.
    const decided = mine.some(isOpen);
    if (a !== undefined) {
      const pick = isObj(a) ? a.pick : a;
      for (const row of mine) {
        const q = row.question;
        if (!q || !isInt(pick) || pick < 0 || pick >= q.options.length) {
          problems.push(`answers.json ${key}: pick 须是选项下标（${row.rid} 有 ${q?.options.length ?? 0} 项）`);
          continue;
        }
        const stated = isObj(a) && typeof a.dest === "string" ? a.dest : "";
        const dest = stated || q.options[pick]?.dest || "";
        if (!DESTS.includes(dest) || dest === "unclear") {
          problems.push(`answers.json ${key}: ${row.rid} 选中的选项写不出归宿，请补 dest`);
          continue;
        }
        row.dest = dest;
        row.destSrc = "answer";
        row.decision = q.options[pick]?.label ?? "";
      }
    } else if (applyDefaults && decided) {
      for (const row of mine) {
        const opt = row.question?.options[row.question.def];
        if (!opt || !DESTS.includes(opt.dest) || opt.dest === "unclear") {
          problems.push(`${row.where}: ${row.rid} 的默认项写不出归宿，不能按默认项走`);
          continue;
        }
        row.dest = opt.dest;
        row.destSrc = "default";
        row.decision = opt.label;
      }
    }
  }
}

function writeRoutes(rows: Row[], raw: Map<string, Record<string, string>>, path: string): void {
  const head = [
    "rid", "batch", "services", "file", "line", "method", "path", "handler",
    "summary", "actor", "callers_evidence", "deps_stores", "deps_external", "side_effect",
    "dest", "dest_src", "confidence", "reason", "decision", "question_topic", "question_q",
  ];
  const lines = [head.join(",")];
  for (const row of [...rows].sort((a, b) => a.rid.localeCompare(b.rid))) {
    const r = raw.get(row.rid) ?? {};
    lines.push(
      [
        row.rid, row.batch, r.services ?? "", r.file ?? "", r.line ?? "", r.method ?? "", r.path ?? "",
        r.handler ?? "", row.summary, row.actor, row.callers, row.stores.join(" | "),
        row.external.join(" | "), row.sideEffect, row.dest, row.destSrc, row.confidence, row.reason,
        row.decision, row.question?.topic ?? "", row.question?.q ?? "",
      ].map(csvField).join(","),
    );
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function writeDecisions(
  rows: Row[],
  raw: Map<string, Record<string, string>>,
  tableOf: Map<string, string>,
  batchesIn: string[],
  path: string,
): void {
  const open = rows.filter(isOpen);
  // Every questioned route, grouped by topic. A topic is shown when at least one of its routes is open;
  // the others are routes that follow that decision.
  const groups = new Map<string, Row[]>();
  for (const r of rows) if (r.question) groups.set(topicOf(r), [...(groups.get(topicOf(r)) ?? []), r]);
  const topics = new Map([...groups].filter(([, rs]) => rs.some(isOpen)));
  const followers = [...topics.values()].reduce((n, rs) => n + rs.length, 0) - open.length;
  const aside = rows.filter((r) => r.question && !topics.has(topicOf(r)));
  // The topic's lead route is the undecided one: open first, then lowest confidence, then the
  // most fully spelled-out question.
  const confRank = (c: string): number => CONFS.indexOf(c);
  const lead = (rs: Row[]): Row =>
    [...rs].sort(
      (a, b) =>
        Number(isOpen(b)) - Number(isOpen(a)) ||
        Number(a.dest === "unclear") - Number(b.dest === "unclear") ||
        confRank(a.confidence) - confRank(b.confidence) ||
        (b.question?.q.length ?? 0) - (a.question?.q.length ?? 0) ||
        a.rid.localeCompare(b.rid),
    )[0] ?? rs[0];
  const answered = rows.filter((r) => r.destSrc === "answer");
  const byDefault = rows.filter((r) => r.destSrc === "default");
  const byDest = countBy(rows, (r) => r.dest);
  const tag = (row: Row): string => {
    const r = raw.get(row.rid) ?? {};
    return `${r.method ?? ""} ${r.path ?? ""}`;
  };
  const out: string[] = ["# 裁决清单", "", "| 项 | 内容 |", "|---|---|"];
  out.push(`| 日期 | ${today()} |`);
  out.push("| 来源 | `merge_parts.ts` 生成，不要手改。答复登记进 `answers.json` 后重新生成 |");
  out.push("| 怎么答 | 一行一题：`R042 a`。不答的按默认项走（任务书 §6.8） |");
  const coverage = RAW_FILES.filter((n) => [...tableOf.values()].includes(n))
    .map((n) => {
      const total = [...tableOf.values()].filter((t) => t === n).length;
      return `${n === "routes.raw.csv" ? "服务端" : "本机端"} ${rows.filter((r) => tableOf.get(r.rid) === n).length} / ${total}`;
    })
    .join("；");
  out.push(`| 已到批次 | ${batchesIn.join("、") || "无"}（${coverage} 条） |`);
  out.push(`| 待你裁决 | ${topics.size} 题：判不准的 ${open.length} 条路由${followers ? `，另有跟着走的 ${followers} 条` : ""} |`);
  out.push(`| 已有答复 | ${answered.length} 条 |`);
  out.push(`| 按默认项走 | ${byDefault.length} 条 |`, "");
  out.push("## 归宿总览", "", "| 归宿 | 条数 |", "|---|---|");
  for (const d of DESTS) out.push(`| ${DEST_LABEL[d]}（${d}） | ${byDest[d] ?? 0} |`);
  out.push("", "| 批次 | 进内核 | 定制包 | 工具 | 退役 | 判不准 | 未到 |", "|---|---|---|---|---|---|---|");
  const all = [...raw.values()];
  for (const b of Object.keys(BATCH_FILES)) {
    const size = all.filter((r) => FILE_BATCH.get(r.file ?? "") === b).length;
    const c = countBy(
      rows.filter((r) => r.batch === b),
      (r) => r.dest,
    );
    out.push(`| ${b} | ${c.kernel ?? 0} | ${c.m ?? 0} | ${c.tool ?? 0} | ${c.retire ?? 0} | ${c.unclear ?? 0} | ${size - Object.values(c).reduce((s, n) => s + n, 0)} |`);
  }
  out.push("", "## 待裁决", "");
  if (!open.length) out.push("没有待裁决的条目。");
  for (const b of Object.keys(BATCH_FILES)) {
    const mine = open.filter((r) => r.batch === b);
    if (!mine.length) continue;
    out.push(`### ${b}`, "");
    const shown = new Set<string>();
    for (const row of mine) {
      const key = topicOf(row);
      if (shown.has(key)) continue;
      shown.add(key);
      const all = groups.get(key) ?? [row];
      const head = lead(all);
      const q = head.question;
      if (!q) continue;
      out.push(`#### ${key}${all.length > 1 ? `（影响 ${all.length} 条）` : ""}`, "");
      if (all.length > 1) {
        for (const r of [...all].sort((x, y) => x.rid.localeCompare(y.rid))) out.push(`- ${r.rid} ${tag(r)}：${r.summary}`);
        out.push("");
      }
      out.push(`- 做什么：${head.summary}`);
      out.push(`- 谁在用：${head.actor}`);
      out.push(`- 证据：${head.callers}`);
      out.push(`- 依赖：数据 ${head.stores.join("、") || "无"}；外部 ${head.external.join("、") || "无"}`);
      out.push(`- 初判：${DEST_LABEL[head.dest]}（把握 ${head.confidence}）`);
      out.push(`- 问：${q.q}`);
      q.options.forEach((o, i) => {
        out.push(`  - ${LETTERS[i]}. ${o.label}${i === q.def ? " ← 默认" : ""}`);
      });
      out.push(`- 默认项的依据：${q.evidence}`, "");
    }
  }
  if (answered.length || byDefault.length) {
    out.push("## 已裁决", "", "| 路由 | 接口 | 所选 | 归宿 | 来源 |", "|---|---|---|---|---|");
    for (const row of [...answered, ...byDefault]) {
      const from = row.destSrc === "answer" ? "你的答复" : "按默认项";
      out.push(`| ${row.rid} | ${md(tag(row))} | ${md(row.decision)} | ${DEST_LABEL[row.dest]} | ${from} |`);
    }
    out.push("");
  }
  if (aside.length) {
    out.push("## 顺带的疑问", "", "这些已有归宿，清点的人只是留了个疑问。可以不看。", "");
    for (const row of aside) {
      out.push(`- **${row.rid} ${tag(row)}**（初判 ${DEST_LABEL[row.dest]}）：${row.question?.q ?? ""}`);
    }
    out.push("");
  }
  writeFileSync(path, `${out.join("\n")}\n`, "utf8");
}

function writeWorkers(workers: Worker[], path: string): void {
  const out = [
    "# 非路由能力清单", "", "| 项 | 内容 |", "|---|---|",
    `| 日期 | ${today()} |`,
    "| 来源 | 各批次 `_meta.workers`，`merge_parts.ts` 生成 |", "",
    "路由之外还在跑的东西：后台循环、定时器、启动钩子。写规格时逐个定归宿。", "",
    "| 批次 | 名称 | 文件 | 做什么 |", "|---|---|---|---|",
  ];
  for (const w of workers) out.push(`| ${w.batch} | ${md(w.name)} | ${w.file} | ${md(w.what)} |`);
  out.push("");
  writeFileSync(path, `${out.join("\n")}\n`, "utf8");
}

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
  const check = argv.includes("--check");
  const problems: string[] = [];
  const { raw, tableOf, rows, workers, batchesIn } = load(problems);
  checkTopics(rows, problems);
  resolve(rows, problems, argv.includes("--apply-defaults"));
  const have = new Set(rows.map((r) => r.rid));
  const missing = [...raw.keys()].filter((rid) => !have.has(rid));
  if (argv.includes("--strict") && missing.length) {
    const shown = missing.slice(0, 20).join(" ");
    problems.push(`--strict：还有 ${missing.length} 条没有结论：${shown}${missing.length > 20 ? " …" : ""}`);
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
  console.log(
    `questions: open ${open.length} routes in ${new Set(open.map((r) => (r.question?.topic || r.rid))).size} topics (unclear ${open.filter((r) => r.dest === "unclear").length}, low ${open.filter((r) => r.dest !== "unclear").length}), answered ${rows.filter((r) => r.destSrc === "answer").length}, by-default ${rows.filter((r) => r.destSrc === "default").length}`,
  );
  console.log(`workers: ${workers.length}`);
  console.log(`problems: ${problems.length}`);
  for (const p of problems.slice(0, 60)) console.log(`  - ${p}`);
  if (problems.length) {
    console.log("not writing: fix the problems first");
    return 1;
  }
  if (check) return 0;
  writeRoutes(rows, raw, join(HERE, "routes.csv"));
  writeDecisions(rows, raw, tableOf, batchesIn, join(HERE, "decisions.md"));
  writeWorkers(workers, join(HERE, "workers.md"));
  console.log("wrote routes.csv, decisions.md, workers.md");
  return 0;
}

process.exitCode = main();
