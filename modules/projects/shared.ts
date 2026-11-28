import type { CurrentUser } from "@nexus/contracts";
import type { Db, Tx } from "@nexus/db";
import type { EventLog, EventRecord } from "@nexus/event-log";
import type { ZodType } from "zod";
import {
  PROJECT_CREATED,
  PROJECT_UPDATED,
  VISIBILITY_CHANGED,
  projectCreatedPayload,
  projectUpdatedPayload,
  visibilityChangedPayload,
} from "./events.ts";
import type { GitRunner } from "./git.ts";
import type { ProjectRecord, ProjectRepo, VisibilityScope } from "./repo.ts";
import { discardRepository, type ProjectHead } from "./repository.ts";

/**
 * 几个用例文件共用的东西：依赖的形状、结果的形状、上下文。
 * 形状也放在这里，是为了让 service.ts 和 create.ts、group-visibility.ts 都不必回头引用对方（模块依赖必须无环）。
 * 用例本身在 service.ts（清单、详情、改）、create.ts（新建）和 group-visibility.ts（一个组的可见工程）；
 * 业务规则只住在这三个文件里，依赖全部由创建函数显式传进来，模块不自己去拿。
 */

/**
 * 调用者：当前登录的账号，加上他所属的用户组编号（规格 G-32、G-34，2026-11-28）。
 * 组编号由访问闸在认证时放进请求上下文，处理函数组装到这里；模块不调身份模块（规格 G-31）。
 */
export type Caller = Pick<CurrentUser, "id" | "isAdmin"> & { groupIds: string[] };

/**
 * 可见性判定：从调用者交出范围（规格 P-10）。清单、详情、改三处都只问它。
 * 缺省实现见 callerScope；测试换成恒假（什么都匹配不上）、恒真（all）。
 */
export type Visibility = (caller: Caller) => VisibilityScope;

/** 缺省的可见性：管理员全部；否则创建者是我，或我的任何一个组看得见。 */
export const callerScope: Visibility = (caller) =>
  caller.isAdmin
    ? { kind: "all" }
    : { kind: "filtered", creatorId: caller.id, groupIds: caller.groupIds };

/**
 * 「这个用户组在不在」（规格 G-31）。身份模块的唯一公开查询，由组合根接到这里；
 * 读和整体替换一个组的可见工程之前先问它，不在回 404。
 */
export type GroupExists = (groupId: string) => Promise<boolean>;

/** 模块要记日志时的最小形状：应用把它的日志器传进来，模块不依赖具体的日志库。 */
export interface ProjectsLog {
  warn(info: Record<string, unknown>, message: string): void;
  error(info: Record<string, unknown>, message: string): void;
}

export interface ProjectsServiceDeps {
  db: Db;
  repo: ProjectRepo;
  eventLog: Pick<EventLog, "emit">;
  /** 配置项 PROJECTS_ROOT，由应用读了环境变量传进来。启动时已经建好。 */
  root: string;
  /** git 执行器，带超时。测试换桩。 */
  git: GitRunner;
  canSee: Visibility;
  /** 「用户组在不在」。身份模块的公开查询，组合根接线；测试换桩（规格 G-31）。 */
  groupExists: GroupExists;
  /** 日志。底层原因连同请求号写在这里，不回给调用方（规格 P-05）。 */
  log?: ProjectsLog;
  /** 当前时间。由应用或测试传入，模块不直接读系统时钟。 */
  now?: () => Date;
}

export interface CreateProjectInput {
  slug: string;
  displayName?: string | undefined;
  avatar?: string | undefined;
}

/** 至少带一个，由路由的形状保证。 */
export interface UpdateProjectInput {
  displayName?: string | undefined;
  avatar?: string | undefined;
}

export type CreateProjectResult =
  | { kind: "ok"; project: ProjectRecord }
  /** 短名已被占用，没建仓库；或者撞上了唯一约束，刚建的仓库已删（规格 P-15、P-21）。 */
  | { kind: "slug_taken" }
  /** 没建成，已回到什么都没发生过（规格 P-20）。 */
  | { kind: "failed" };

export type UpdateProjectResult =
  | { kind: "ok"; project: ProjectRecord }
  | { kind: "not_found" }
  | { kind: "forbidden" };

/** 一条看得见的工程加它默认分支的最新提交（规格 P-25）。 */
export interface ProjectDetail {
  project: ProjectRecord;
  head: ProjectHead;
}

export interface ProjectsContext {
  deps: ProjectsServiceDeps;
  now(): Date;
  /** 发一条事件，和同一个事务里的业务写入一起成、一起败（规格 P-24、P-33）。 */
  emit(
    tx: Tx,
    type: string,
    subject: string,
    payload: unknown,
    traceId: string | undefined,
  ): Promise<EventRecord>;
  /** 建仓或写记录失败：底层原因连同请求号写进日志（规格 P-05）。 */
  report(step: string, projectId: string, traceId: string | undefined, err: unknown): void;
  /** 记录落不下时扔掉刚建的仓库；删不掉要留痕（规格 P-06）。 */
  discard(projectId: string, traceId: string | undefined): Promise<void>;
}

/**
 * 发事件之前先过形状（沿用身份模块的做法）：payload 里多一个键、`changes` 一个改动都没有，都当场抛，
 * 不让夹带服务器路径的事件写进库（规格 P-35）。认不出的类型不拦：别处往后加了事件、忘了登记形状，不该把业务拦下。
 */
const PAYLOAD_SCHEMAS: Record<string, ZodType> = {
  [PROJECT_CREATED]: projectCreatedPayload,
  [PROJECT_UPDATED]: projectUpdatedPayload,
  [VISIBILITY_CHANGED]: visibilityChangedPayload,
};

export function createProjectsContext(deps: ProjectsServiceDeps): ProjectsContext {
  const now = deps.now ?? ((): Date => new Date());
  return {
    deps,
    now,
    // 写成 async：形状不对时拒绝，而不是同步抛。调用方一律 await，两种写法到了那里都一样。
    async emit(tx, type, subject, payload, traceId) {
      const schema = PAYLOAD_SCHEMAS[type];
      if (schema !== undefined && !schema.safeParse(payload).success) {
        throw new Error(
          `事件 ${type} 的 payload 不合形状：${JSON.stringify(Object.keys(payload as object))}`,
        );
      }
      return deps.eventLog.emit(
        {
          type,
          source: "projects",
          subject,
          payload,
          occurredAt: now().toISOString(),
          ...(traceId === undefined ? {} : { traceId }),
        },
        tx,
      );
    },
    report(step, projectId, traceId, err) {
      deps.log?.error({ requestId: traceId, projectId, step, err }, "工程没建成");
    },
    async discard(projectId, traceId) {
      if (!(await discardRepository(deps.root, projectId))) {
        deps.log?.warn({ requestId: traceId, projectId }, "记录没落下，裸仓库却删不掉");
      }
    },
  };
}

// 「违反唯一约束」的判定住在 @nexus/db（isUniqueViolation，沿 cause 链找 23505）：这是数据库层的
// 知识，不是工程的；身份模块同款共用（2026-11-28 挪到公共包）。这里转出口，调用处不用改。
export { isUniqueViolation } from "@nexus/db";
