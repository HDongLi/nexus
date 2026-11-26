import { z } from "zod";

/** 模块名与事件名只用小写字母、数字和连字符。事件名是「模块.动作」，如 system.started。 */
export const moduleName = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const eventName = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z-]*$/);

/**
 * 事件信封：全平台每一条事件都长这个样子（主张 P7）。
 * payload 的形状由发出它的模块在自己的 events.ts 里定义，这里不约束。
 */
export const eventEnvelope = z.object({
  type: eventName,
  source: moduleName,
  subject: z.string().min(1).optional(),
  payload: z.unknown(),
  occurredAt: z.iso.datetime(),
  traceId: z.string().min(1).optional(),
});

export type EventEnvelope = z.output<typeof eventEnvelope>;
