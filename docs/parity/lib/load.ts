// Reading and validating: raw tables, part files, answers, and the rules every row must satisfy.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "./csv.ts";
import {
  BATCH_FILES,
  CONFS,
  DESTS,
  DEST_HINT,
  RAW_FILES,
  FILE_BATCH,
  SIDE,
  isInt,
  isObj,
  isOpen,
  flat,
  topicOf,
  type Loaded,
  type Option,
  type Question,
  type Row,
  type Worker,
} from "./model.ts";

const HERE = join(import.meta.dirname, "..");

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
    row.summary,
    row.actor,
    row.callers,
    row.reason,
    ...row.stores,
    ...row.external,
    row.question?.q ?? "",
    row.question?.evidence ?? "",
    ...(row.question?.options.map((o) => o.label) ?? []),
  ].join("\n");

function destOfLabel(label: string): string {
  const s = label.toLowerCase();
  const hits = Object.entries(DEST_HINT).filter(([, hints]) => hints.some((h) => s.includes(h)));
  return hits.length === 1 ? (hits[0]?.[0] ?? "") : "";
}

function asList(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return v.trim() ? [flat(v)] : [];
  if (Array.isArray(v)) return v.map(flat).filter(Boolean);
  return [JSON.stringify(v)];
}

function readRawTables(): Pick<Loaded, "raw" | "tableOf"> {
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
  return { raw, tableOf };
}

export function load(problems: string[]): Loaded {
  const { raw, tableOf } = readRawTables();
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
    return {
      q: flat(q.q),
      options: opts.map(optNorm),
      def,
      evidence: flat(q.evidence),
      topic: flat(q.topic),
    };
  };

  for (const batch of Object.keys(BATCH_FILES)) {
    const partPath = join(HERE, "parts", `${batch}.jsonl`);
    if (!existsSync(partPath)) continue;
    batchesIn.push(batch);
    for (const [n, obj] of readPart(batch, readFileSync(partPath, "utf8"), problems)) {
      const where = `${batch}.jsonl:${n}`;
      if (!isObj(obj)) {
        problems.push(`${where}: 不是对象`);
        continue;
      }
      if ("_meta" in obj) {
        const meta = obj._meta;
        if (isObj(meta) && Array.isArray(meta.workers)) {
          for (const w of meta.workers) {
            if (isObj(w))
              workers.push({ batch, name: flat(w.name), file: flat(w.file), what: flat(w.what) });
          }
        }
        continue;
      }
      const row = rowOf(obj, where, batch, raw, seen, problems, qNorm);
      if (!row) continue;
      rows.push(row);
      const hit = SENSITIVE.exec(textOf(row));
      if (hit)
        problems.push(
          `${where}: ${row.rid} 含内网名或地址「${hit[0]}」，改成「开发机 / 生产机 / 本机」`,
        );
    }
  }
  for (const w of workers) {
    const hit = SENSITIVE.exec([w.name, w.file, w.what].join("\n"));
    if (hit) problems.push(`workers（${w.batch}）${w.name}: 含内网名或地址「${hit[0]}」`);
  }
  return { raw, tableOf, rows, workers, batchesIn };
}

/** One JSON object per line; a single JSON array is accepted too. */
function readPart(batch: string, text: string, problems: string[]): [number, unknown][] {
  const objs: [number, unknown][] = [];
  if (text.trimStart().startsWith("[")) {
    try {
      for (const o of JSON.parse(text) as unknown[]) objs.push([0, o]);
    } catch (e) {
      problems.push(`${batch}.jsonl: 不是合法的 JSON（${String(e)}）`);
    }
    return objs;
  }
  text
    .replace(/^﻿/, "")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return;
      try {
        objs.push([i + 1, JSON.parse(line)]);
      } catch (e) {
        problems.push(`${batch}.jsonl:${i + 1}: 不是合法 JSON（${String(e)}）`);
      }
    });
  return objs;
}

function rowOf(
  obj: Record<string, unknown>,
  where: string,
  batch: string,
  raw: Map<string, Record<string, string>>,
  seen: Map<string, string>,
  problems: string[],
  qNorm: (q: unknown, where: string) => Question | null,
): Row | undefined {
  const rid = flat(obj.rid);
  const r = raw.get(rid);
  if (!r) {
    problems.push(`${where}: rid ${rid || "(空)"} 不在底表里`);
    return undefined;
  }
  const owner = FILE_BATCH.get(r.file ?? "");
  if (owner !== batch) problems.push(`${where}: ${rid} 属于批次 ${owner ?? "?"}，不是 ${batch}`);
  if (seen.has(rid)) {
    problems.push(`${where}: ${rid} 重复，先见于 ${seen.get(rid)}`);
    return undefined;
  }
  seen.set(rid, where);

  const need = (f: string): string => {
    const v = obj[f];
    if (typeof v !== "string" || !v.trim()) problems.push(`${where}: 缺字段 ${f}`);
    return flat(v);
  };
  const row: Row = {
    rid,
    batch,
    where,
    summary: need("summary"),
    actor: need("actor"),
    callers: need("callers_evidence"),
    sideEffect: need("side_effect"),
    reason: need("reason"),
    stores: [],
    external: [],
    dest: "unclear",
    confidence: "low",
    question: null,
    destSrc: "agent",
    decision: "",
  };
  if (DESTS.includes(String(obj.dest))) row.dest = String(obj.dest);
  else problems.push(`${where}: dest 须是 ${DESTS.join(" / ")}`);
  if (CONFS.includes(String(obj.confidence))) row.confidence = String(obj.confidence);
  else problems.push(`${where}: confidence 须是 ${CONFS.join(" / ")}`);
  const bad = row.sideEffect
    .toLowerCase()
    .split(/[+,，/|]+/)
    .filter((t) => t && !SIDE.includes(t));
  if (bad.length) problems.push(`${where}: side_effect 含未知值 ${bad.join(" ")}`);
  const deps = obj.deps;
  if (!isObj(deps)) problems.push(`${where}: 缺 deps`);
  row.stores = asList(isObj(deps) ? deps.stores : undefined);
  row.external = asList(isObj(deps) ? deps.external : undefined);
  row.question = qNorm(obj.question, where);
  if (isOpen(row) && !row.question)
    problems.push(`${where}: dest=unclear 或 confidence=low 时必须给 question`);
  return row;
}

/** Routes sharing a topic must offer the same choice: same option count, same default index. */
export function checkTopics(rows: Row[], problems: string[]): void {
  const head = new Map<string, Row>();
  for (const r of rows) {
    if (!r.question) continue;
    const first = head.get(topicOf(r));
    if (!first) head.set(topicOf(r), r);
    else if (
      first.question?.options.length !== r.question.options.length ||
      first.question.def !== r.question.def
    ) {
      problems.push(
        `${r.where}: ${r.rid} 与 ${first.rid} 同题（${topicOf(r)}），但选项数或默认项不一致`,
      );
    }
  }
}

/** Applies answers.json and (optionally) default options. Mutates rows in place. */
export function resolve(rows: Row[], problems: string[], applyDefaults: boolean): void {
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
          problems.push(
            `answers.json ${key}: pick 须是选项下标（${row.rid} 有 ${q?.options.length ?? 0} 项）`,
          );
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
