import type { Db } from "@nexus/db";
import { createEventLog, type EventLog } from "@nexus/event-log";
import {
  createIdentityModule,
  createIdentityRepo,
  identityContract,
  type IdentityModule,
  type IdentityRepo,
} from "@nexus/identity";
import {
  createSystemModule,
  createSystemRepo,
  systemContract,
  type SystemModule,
} from "@nexus/system";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { createApp } from "./app.ts";
import { clientIp } from "./http/client-ip.ts";
import { createIdentityVerifier } from "./http/identity-verifier.ts";

export interface ComposeInput {
  db: Db;
  log: Logger;
  version: string;
  runtime: string;
  /** 对外地址（配置项 PUBLIC_ORIGIN），启动时校验过。没配就按请求自己的地址比对来源。 */
  publicOrigin?: string | undefined;
  passwordMinLength: number;
  /** 当前时间。测试拨表用，不给就是系统时钟。 */
  now?: () => Date;
  /** 身份模块的仓储。不给就是真的；集成测试换一份进来，比如写入之后故意抛错，验事件跟着回滚（规格 I-41）。 */
  repo?: IdentityRepo;
}

export interface Composed {
  app: ReturnType<typeof createApp>["app"];
  eventLog: EventLog;
  system: SystemModule;
  identity: IdentityModule;
  /** 这一轮启动的编号，把这一轮的日志和事件串起来。 */
  bootId: string;
}

/**
 * 把各模块装进应用。进程启动、集成测试都走这一个函数，走的是同一份接线：
 * 手工拼一份「差不多的」应用来测，测通过的就不是真正上线的那一份（2026-11-27，身份模块接入时抽出）。
 * 这里只有装配，没有业务（主张 P4）。
 */
export async function composeApp(input: ComposeInput): Promise<Composed> {
  const clock = input.now === undefined ? {} : { now: input.now };
  const eventLog = createEventLog({ db: input.db });

  const system = createSystemModule({
    repo: createSystemRepo(input.db),
    eventLog,
    version: input.version,
    runtime: input.runtime,
    ...clock,
  });
  const bootId = randomUUID();
  await system.service.recordStart(bootId);

  const identity = createIdentityModule({
    db: input.db,
    repo: input.repo ?? createIdentityRepo(),
    eventLog,
    passwordMinLength: input.passwordMinLength,
    clientIp,
    ...clock,
  });

  const { app } = createApp({
    log: input.log,
    modules: [
      { name: systemContract.name, bindings: system.bindings },
      { name: identityContract.name, bindings: identity.bindings },
    ],
    verify: createIdentityVerifier(identity),
    publicOrigin: input.publicOrigin,
  });

  return { app, eventLog, system, identity, bootId };
}
