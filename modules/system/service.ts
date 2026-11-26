import type { EventLog } from "@nexus/event-log";
import { SYSTEM_STARTED, systemStartedPayload, type SystemStartedPayload } from "./events.ts";
import type { SystemRepo } from "./repo.ts";

export interface Health {
  status: "ok" | "degraded";
  version: string;
  time: string;
  checks: {
    db: "ok" | "fail";
  };
}

export interface BootRecord {
  bootId: string;
  startedAt: string;
  version: string;
}

export interface SystemInfo {
  version: string;
  /** 本次启动。 */
  boot: BootRecord;
  /** 最近几次启动，新的在前。 */
  recentBoots: BootRecord[];
}

export interface SystemService {
  health(): Promise<Health>;
  /** 调用前必须先 recordStart。 */
  info(): Promise<SystemInfo>;
  recordStart(bootId: string): Promise<void>;
}

export interface SystemDeps {
  repo: SystemRepo;
  eventLog: Pick<EventLog, "emit" | "list">;
  version: string;
  /** 运行时版本，由应用传进来（模块不直接读 process，方便测）。 */
  runtime: string;
  now?: () => Date;
}

const RECENT = 5;

export function createSystemService(deps: SystemDeps): SystemService {
  const now = deps.now ?? (() => new Date());
  let boot: BootRecord | undefined;

  return {
    async health() {
      const dbOk = await deps.repo.ping();
      return {
        status: dbOk ? "ok" : "degraded",
        version: deps.version,
        time: now().toISOString(),
        checks: { db: dbOk ? "ok" : "fail" },
      };
    },

    async info() {
      if (!boot) throw new Error("系统模块还没有启动：先调 recordStart");
      const rows = await deps.eventLog.list({ type: SYSTEM_STARTED, limit: RECENT });
      const recentBoots = rows.map((row) => toBootRecord(row.occurredAt, row.payload));
      return { version: deps.version, boot, recentBoots };
    },

    async recordStart(bootId) {
      const startedAt = now().toISOString();
      await deps.eventLog.emit({
        type: SYSTEM_STARTED,
        source: "system",
        payload: {
          bootId,
          version: deps.version,
          node: deps.runtime,
        } satisfies SystemStartedPayload,
        occurredAt: startedAt,
      });
      boot = { bootId, startedAt, version: deps.version };
    },
  };
}

function toBootRecord(occurredAt: string, payload: unknown): BootRecord {
  const parsed = systemStartedPayload.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `事件 ${SYSTEM_STARTED} 的 payload 不合形状：${parsed.error.issues[0]?.message ?? ""}`,
    );
  }
  return { bootId: parsed.data.bootId, startedAt: occurredAt, version: parsed.data.version };
}
