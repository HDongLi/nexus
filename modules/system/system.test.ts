import type { EmitInput, EventRecord } from "@nexus/event-log";
import { describe, expect, it } from "vitest";
import { createSystemModule, SYSTEM_STARTED } from "./index.ts";
import type { SystemDeps } from "./service.ts";

const FIXED = new Date("2026-11-26T06:00:00.000Z");

function makeDeps(overrides: Partial<SystemDeps> = {}): SystemDeps & { emitted: EmitInput[] } {
  const emitted: EmitInput[] = [];
  return {
    emitted,
    repo: { ping: async () => true },
    eventLog: {
      emit: async (input) => {
        emitted.push(input);
        return {
          id: 1,
          type: input.type,
          source: input.source,
          payload: input.payload,
          occurredAt: input.occurredAt ?? "",
        };
      },
      list: async () => [],
    },
    version: "1.2.3",
    runtime: "v24.22.3",
    now: () => FIXED,
    ...overrides,
  };
}

describe("系统模块的用例", () => {
  it("数据库连得上就是健康", async () => {
    const { service } = createSystemModule(makeDeps());
    expect(await service.health()).toEqual({
      status: "ok",
      version: "1.2.3",
      time: FIXED.toISOString(),
      checks: { db: "ok" },
    });
  });

  it("数据库连不上就降级，不是崩溃", async () => {
    const { service } = createSystemModule(makeDeps({ repo: { ping: async () => false } }));
    const health = await service.health();
    expect(health.status).toBe("degraded");
    expect(health.checks.db).toBe("fail");
  });

  it("启动时发一条 system.started，带启动号、版本和运行时", async () => {
    const deps = makeDeps();
    const { service } = createSystemModule(deps);
    await service.recordStart("6f1c0f5e-1111-4222-8333-444455556666");
    expect(deps.emitted).toEqual([
      {
        type: SYSTEM_STARTED,
        source: "system",
        payload: {
          bootId: "6f1c0f5e-1111-4222-8333-444455556666",
          version: "1.2.3",
          node: "v24.22.3",
        },
        occurredAt: FIXED.toISOString(),
      },
    ]);
  });

  it("没启动就问信息，直接报错", async () => {
    const { service } = createSystemModule(makeDeps());
    await expect(service.info()).rejects.toThrow(/还没有启动/);
  });

  it("信息里有本次启动和最近几次启动", async () => {
    const rows: EventRecord[] = [
      {
        id: 2,
        type: SYSTEM_STARTED,
        source: "system",
        payload: { bootId: "00000000-0000-4000-8000-000000000002", version: "1.2.3", node: "v24" },
        occurredAt: "2026-11-26T06:00:00.000Z",
      },
      {
        id: 1,
        type: SYSTEM_STARTED,
        source: "system",
        payload: { bootId: "00000000-0000-4000-8000-000000000001", version: "1.2.2", node: "v24" },
        occurredAt: "2026-11-25T06:00:00.000Z",
      },
    ];
    const deps = makeDeps({
      eventLog: {
        emit: async (input) => ({
          id: 3,
          type: input.type,
          source: input.source,
          payload: input.payload,
          occurredAt: "",
        }),
        list: async () => rows,
      },
    });
    const { service } = createSystemModule(deps);
    await service.recordStart("00000000-0000-4000-8000-000000000003");
    const info = await service.info();
    expect(info.version).toBe("1.2.3");
    expect(info.boot).toEqual({
      bootId: "00000000-0000-4000-8000-000000000003",
      startedAt: FIXED.toISOString(),
      version: "1.2.3",
    });
    expect(info.recentBoots.map((boot) => boot.version)).toEqual(["1.2.3", "1.2.2"]);
  });
});
