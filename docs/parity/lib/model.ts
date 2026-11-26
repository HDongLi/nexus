// Vocabulary, batches and the in-memory shapes shared by the parity merge (see SCHEMA.md).

export const DESTS = ["kernel", "m", "tool", "retire", "unclear"];
export const CONFS = ["high", "mid", "low"];
export const SIDE = ["read", "write", "exec", "network"];
export const LETTERS = "abcd";

/** Which route files belong to which part file. The order is the report order. */
export const BATCH_FILES: Record<string, string[]> = {
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
  "f-identity": [
    "identity/registry.py",
    "identity/oracle.py",
    "prod/ai_gateway.py",
    "prod/client_update.py",
  ],
  // The local client: its routes all retire (charter D-2); what is classified is the capability.
  "g-client": ["main.py"],
};
/** Raw tables, in report order. The first is the charter's 272; the second is the local client. */
export const RAW_FILES = ["routes.raw.csv", "client.raw.csv"];
export const FILE_BATCH = new Map<string, string>(
  Object.entries(BATCH_FILES).flatMap(([b, fs]) => fs.map((f) => [f, b])),
);

export const DEST_LABEL: Record<string, string> = {
  kernel: "进内核",
  m: "进定制包",
  tool: "作为工具重建",
  retire: "退役",
  unclear: "判不准",
};
// Words in an option label that name a destination. Exactly one hit = the option's destination.
export const DEST_HINT: Record<string, string[]> = {
  kernel: ["kernel", "内核"],
  m: ["定制"],
  tool: ["tool", "工具"],
  retire: ["retire", "退役", "不进新版"],
};

export interface Option {
  label: string;
  dest: string;
}
export interface Question {
  q: string;
  options: Option[];
  def: number;
  evidence: string;
  // Several routes that share one decision carry the same topic; the product owner answers once.
  topic: string;
}
export interface Row {
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
export interface Worker {
  batch: string;
  name: string;
  file: string;
  what: string;
}
export interface Loaded {
  raw: Map<string, Record<string, string>>;
  tableOf: Map<string, string>;
  rows: Row[];
  workers: Worker[];
  batchesIn: string[];
}

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
export const flat = (v: unknown): string =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
/** Escape pipes so a value can sit inside a Markdown table cell. */
export const md = (s: string): string => s.replace(/\|/g, "\\|");
/** A route still waiting for a verdict: undecided, or decided with low confidence. */
export const isOpen = (r: Row): boolean => r.dest === "unclear" || r.confidence === "low";
export const topicOf = (r: Row): string => r.question?.topic || r.rid;
export const countBy = (rows: Row[], key: (r: Row) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1;
  return out;
};
export const today = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
