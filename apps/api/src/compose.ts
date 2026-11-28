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
  callerScope,
  createGitRunner,
  createProjectsModule,
  createProjectsRepo,
  projectsContract,
  type GitRunner,
  type GroupExists,
  type ProjectRepo,
  type ProjectsModule,
  type Visibility,
} from "@nexus/projects";
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

/** 工程模块的可替换件。不给就是真的；集成测试换进来（规格 P-10、P-20、P-22、G-31）。 */
export interface ProjectsOptions {
  /** 可见性判定：比如换成恒假、恒真（范围形状见 @nexus/projects 的 VisibilityScope）。 */
  canSee?: Visibility;
  /** 「用户组在不在」的查询：换成恒假、恒真的桩验两条组路由的反应（规格 G-31）。 */
  groupExists?: GroupExists;
  /** git 执行器：比如换成会失败、会挂起的桩。 */
  git?: GitRunner;
  /** 仓储：换成写入之后故意抛错的，验事件跟着回滚、刚建的仓库被扔掉（规格 P-20）。 */
  repo?: ProjectRepo;
}

export interface ComposeInput {
  db: Db;
  log: Logger;
  version: string;
  runtime: string;
  /** 对外地址（配置项 PUBLIC_ORIGIN），启动时校验过。没配就按请求自己的地址比对来源。 */
  publicOrigin?: string | undefined;
  passwordMinLength: number;
  /** 配置项 PROJECTS_ROOT。启动时已经建好；集成测试指到临时目录。 */
  projectsRoot: string;
  /** 当前时间。测试拨表用，不给就是系统时钟。 */
  now?: () => Date;
  /** 身份模块的仓储。不给就是真的；集成测试换一份进来，比如写入之后故意抛错，验事件跟着回滚（规格 I-41）。 */
  repo?: IdentityRepo;
  /** 工程模块的可替换件。不给就是真的。 */
  projects?: ProjectsOptions;
}

export interface Composed {
  app: ReturnType<typeof createApp>["app"];
  eventLog: EventLog;
  system: SystemModule;
  identity: IdentityModule;
  projects: ProjectsModule;
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

  // 可见性是「管理员全部；否则创建者或组员」（规格 G-32）；「组在不在」接身份模块的公开查询（规格 G-31）。
  // 认证结果里的组编号经访问闸进请求上下文，工程的路由处理函数组装给模块（规格 G-34）。
  const projects = createProjectsModule({
    db: input.db,
    repo: input.projects?.repo ?? createProjectsRepo(),
    eventLog,
    root: input.projectsRoot,
    git: input.projects?.git ?? createGitRunner(),
    canSee: input.projects?.canSee ?? callerScope,
    groupExists: input.projects?.groupExists ?? identity.service.groupExists,
    // 建仓失败时模块要把底层原因连同请求号写进日志（规格 P-05）。
    log: input.log,
    ...clock,
  });

  const { app } = createApp({
    log: input.log,
    modules: [
      { name: systemContract.name, bindings: system.bindings },
      { name: identityContract.name, bindings: identity.bindings },
      { name: projectsContract.name, bindings: projects.bindings },
    ],
    verify: createIdentityVerifier(identity),
    publicOrigin: input.publicOrigin,
  });

  return { app, eventLog, system, identity, projects, bootId };
}
