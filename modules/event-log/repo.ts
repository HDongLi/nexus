import type { Executor } from "@nexus/db";
import { and, desc, eq, gt, type SQL } from "drizzle-orm";
import { events } from "./schema.ts";

export type EventRow = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export interface EventListQuery {
  type?: string | undefined;
  subject?: string | undefined;
  /** 只要编号比它大的（从上次读到的地方接着读）。 */
  after?: number | undefined;
  limit: number;
}

/** 本模块唯一写 SQL 的地方（任务书 §5.3）。做成接口是为了能单独换成假的来测用例。 */
export interface EventRepo {
  insert(ex: Executor, row: NewEvent): Promise<EventRow>;
  list(ex: Executor, query: EventListQuery): Promise<EventRow[]>;
}

export function createEventRepo(): EventRepo {
  return {
    async insert(ex, row) {
      const rows = await ex.insert(events).values(row).returning();
      const inserted = rows[0];
      if (!inserted) throw new Error("事件写进去了却读不回来");
      return inserted;
    },
    async list(ex, query) {
      const conditions: SQL[] = [];
      if (query.type !== undefined) conditions.push(eq(events.type, query.type));
      if (query.subject !== undefined) conditions.push(eq(events.subject, query.subject));
      if (query.after !== undefined) conditions.push(gt(events.id, query.after));
      return ex
        .select()
        .from(events)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(events.id))
        .limit(query.limit);
    },
  };
}
