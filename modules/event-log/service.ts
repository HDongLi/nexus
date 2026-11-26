import { eventEnvelope } from "@nexus/contracts";
import type { Db, Tx } from "@nexus/db";
import { createEventRepo, type EventListQuery, type EventRepo, type EventRow } from "./repo.ts";

/** 对外的事件记录：时间是 ISO 字符串，没有的可选项就不出现（不把 null 漏给调用方）。 */
export interface EventRecord {
  id: number;
  type: string;
  source: string;
  subject?: string;
  payload: unknown;
  occurredAt: string;
  traceId?: string;
}

export interface EmitInput {
  type: string;
  source: string;
  subject?: string;
  payload: unknown;
  /** 不给就用现在。测试和补录历史时给。 */
  occurredAt?: string;
  traceId?: string;
}

export interface EventLog {
  /**
   * 写一条事件。给了 tx 就和调用方的业务写入在同一个事务里：一起成，或者一起败。
   * 这就是「事务性发件箱」的全部：事件不会比业务先落地，也不会丢。
   */
  emit(input: EmitInput, tx?: Tx): Promise<EventRecord>;
  /** 新的在前。limit 上限 200。 */
  list(query: Omit<EventListQuery, "limit"> & { limit?: number }): Promise<EventRecord[]>;
}

const MAX_LIMIT = 200;

/** 事件不合信封时抛这个。message 里带哪一项不对。 */
export class InvalidEventError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`事件不合信封：${issues.join("；")}`);
    this.name = "InvalidEventError";
    this.issues = issues;
  }
}

function toRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    ...(row.subject === null ? {} : { subject: row.subject }),
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
    ...(row.traceId === null ? {} : { traceId: row.traceId }),
  };
}

export function createEventLog(deps: { db: Db; repo?: EventRepo }): EventLog {
  const repo = deps.repo ?? createEventRepo();

  return {
    async emit(input, tx) {
      const parsed = eventEnvelope.safeParse({
        type: input.type,
        source: input.source,
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        payload: input.payload,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
      });
      if (!parsed.success) {
        throw new InvalidEventError(
          parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        );
      }
      const row = await repo.insert(tx ?? deps.db, {
        type: parsed.data.type,
        source: parsed.data.source,
        subject: parsed.data.subject ?? null,
        payload: parsed.data.payload,
        occurredAt: new Date(parsed.data.occurredAt),
        traceId: parsed.data.traceId ?? null,
      });
      return toRecord(row);
    },

    async list(query) {
      const rows = await repo.list(deps.db, {
        type: query.type,
        subject: query.subject,
        after: query.after,
        limit: Math.min(Math.max(query.limit ?? 50, 1), MAX_LIMIT),
      });
      return rows.map(toRecord);
    },
  };
}
