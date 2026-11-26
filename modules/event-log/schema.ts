import { bigserial, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * 事件日志：全平台事件的唯一落点，也是事务性发件箱的表（主张 P7）。
 * 只追加，不更新，不删除。旧事件的归档是以后的事，到时候另起决定记录。
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** 「模块.动作」，如 system.started */
    type: text("type").notNull(),
    /** 发出事件的模块 */
    source: text("source").notNull(),
    /** 这件事关乎谁：工程名、任务号之类。可以没有。 */
    subject: text("subject"),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    traceId: text("trace_id"),
  },
  (table) => [
    // 两个最常见的读法：按类型从头追，按对象看它的来龙去脉。
    index("events_type_id_idx").on(table.type, table.id),
    index("events_subject_id_idx").on(table.subject, table.id),
  ],
);
