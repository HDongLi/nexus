import { bind, type AnyRouteBinding } from "@nexus/http-kit";
import { SYSTEM_STARTED, systemStartedPayload } from "./events.ts";
import type { SystemRepo } from "./repo.ts";
import { healthRoute, infoRoute, systemContract } from "./routes.ts";
import {
  createSystemService,
  type BootRecord,
  type Health,
  type SystemDeps,
  type SystemInfo,
  type SystemService,
} from "./service.ts";

/** 模块对外交出来的东西：绑好处理函数的路由，加用例。 */
export interface SystemModule {
  bindings: readonly AnyRouteBinding[];
  service: SystemService;
}

/** 本模块唯一出口（任务书 §5.3）。别的模块和应用只准 import 这一个文件。 */
export function createSystemModule(deps: SystemDeps): SystemModule {
  const service = createSystemService(deps);
  return {
    service,
    bindings: [
      bind(healthRoute, async (c) => {
        const health = await service.health();
        if (health.status === "degraded") return c.json(health, 503);
        return c.json(health, 200);
      }),
      bind(infoRoute, async (c) => c.json(await service.info(), 200)),
    ],
  };
}

export { SYSTEM_STARTED, systemContract, systemStartedPayload };
export { createSystemRepo } from "./repo.ts";
export type { BootRecord, Health, SystemDeps, SystemInfo, SystemRepo, SystemService };
