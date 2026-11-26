import { z } from "zod";

/** 进程每启动一次发一条。bootId 每次都是新的，用它把这一轮的日志和事件串起来。 */
export const SYSTEM_STARTED = "system.started" as const;

export const systemStartedPayload = z.object({
  bootId: z.string().uuid(),
  version: z.string().min(1),
  /** 运行时版本，如 v24.22.3。排障时先看它。 */
  node: z.string().min(1),
});

export type SystemStartedPayload = z.output<typeof systemStartedPayload>;
