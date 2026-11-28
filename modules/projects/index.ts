import { bind, fail, requireUser, type AnyRouteBinding, type AppEnv } from "@nexus/http-kit";
import type { Context } from "hono";
import { projectsErrorCodes } from "./codes.ts";
import type { ProjectRecord } from "./repo.ts";
import {
  createRoute,
  detailRoute,
  getGroupProjectsRoute,
  listRoute,
  setGroupProjectsRoute,
  updateRoute,
} from "./routes.ts";
import { createProjectsService, type ProjectsService } from "./service.ts";
import type { Caller, ProjectsServiceDeps } from "./shared.ts";

/** 模块交给应用挂载的东西：绑好处理函数的路由，加用例。 */
export interface ProjectsModule {
  bindings: readonly AnyRouteBinding[];
  service: ProjectsService;
}

/**
 * 看不见和不存在的回应逐字相同，所以两者走同一句话、同一个码（规格 P-11）。
 * 旧系统回 403 并说明它不在你的归属里，等于告诉人「这个工程存在」（规格 P-11 的来源）。
 */
const NOT_FOUND_MESSAGE = "没有这个工程";

/** 记录怎么回给调用方：恰好七个键，时间转成带时区的 ISO 8601。里面没有服务器上的路径（规格 P-05）。 */
export function toProject(record: ProjectRecord) {
  return {
    id: record.id,
    slug: record.slug,
    displayName: record.displayName,
    avatar: record.avatar,
    createdById: record.createdById,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * 本模块唯一出口（任务书 §5.3）。别的模块和应用只准 import 这一个文件，
 * 依赖方向检查会拦下伸进来的手。处理函数只做三件事：解析入参、调用用例、把结果交回去。
 */
export function createProjectsModule(deps: ProjectsServiceDeps): ProjectsModule {
  const service = createProjectsService(deps);
  // 调用者带上他所属的用户组编号：访问闸在认证时放进上下文（规格 G-34），模块不调身份模块（规格 G-31）。
  const caller = (c: Context<AppEnv>): Caller => ({
    ...requireUser(c),
    groupIds: c.get("groupIds") ?? [],
  });
  const notFound = (c: Context<AppEnv>) => fail(c, 404, "not_found", NOT_FOUND_MESSAGE);

  return {
    service,
    bindings: [
      bind(listRoute, async (c) => {
        const projects = await service.list(caller(c));
        return c.json({ projects: projects.map(toProject) }, 200);
      }),
      bind(createRoute, async (c) => {
        const result = await service.create(caller(c), c.req.valid("json"), c.get("requestId"));
        if (result.kind === "ok") return c.json({ project: toProject(result.project) }, 201);
        if (result.kind === "slug_taken") {
          return fail(c, 409, projectsErrorCodes.slugTaken, "这个短名已经被占用了，换一个");
        }
        // 失败的原因（多半带服务器上的路径）只进日志，这里回一句人话（规格 P-05）。
        return fail(
          c,
          500,
          projectsErrorCodes.creationFailed,
          "工程没建起来，什么都没留下。稍后再试；还不行就带上请求号找管理员",
        );
      }),
      bind(detailRoute, async (c) => {
        const found = await service.get(caller(c), c.req.valid("param").projectId);
        if (!found) return notFound(c);
        return c.json({ project: { ...toProject(found.project), head: found.head } }, 200);
      }),
      bind(updateRoute, async (c) => {
        const result = await service.update(
          caller(c),
          c.req.valid("param").projectId,
          c.req.valid("json"),
          c.get("requestId"),
        );
        if (result.kind === "ok") return c.json({ project: toProject(result.project) }, 200);
        if (result.kind === "forbidden") {
          return fail(c, 403, projectsErrorCodes.forbidden, "只有创建者和管理员能改这个工程");
        }
        return notFound(c);
      }),
      bind(getGroupProjectsRoute, async (c) => {
        const result = await service.listGroupProjects(c.req.valid("param").groupId);
        if (result.kind === "ok") return c.json({ projectIds: result.projectIds }, 200);
        return notFound(c);
      }),
      bind(setGroupProjectsRoute, async (c) => {
        const result = await service.setGroupProjects(
          requireUser(c).id,
          c.req.valid("param").groupId,
          c.req.valid("json").projectIds,
          c.get("requestId"),
        );
        if (result.kind === "ok" || result.kind === "no_change") {
          return c.json({ projectIds: result.projectIds }, 200);
        }
        if (result.kind === "unknown_project") {
          return fail(c, 400, "invalid_request", "工程编号里有不存在的");
        }
        return notFound(c);
      }),
    ],
  };
}

export { projectsContract } from "./routes.ts";
export { projectsErrorCodes } from "./codes.ts";
export { createProjectsRepo } from "./repo.ts";
export { createProjectsService } from "./service.ts";
// 缺省的可见性范围（管理员全部；否则创建者或组员），2026-11-28 起随出口导出，组合根当缺省用。
export { callerScope } from "./shared.ts";
export { createGitRunner, GIT_IDENTITY, GIT_TIMEOUT_MS, GitError } from "./git.ts";
export type { GitOutput, GitRunner, GitRunnerOptions } from "./git.ts";
export { DEFAULT_BRANCH, INITIAL_FILES } from "./initial-files.ts";
export type { ProjectHead } from "./repository.ts";
export { projectGroups } from "./schema.ts";
export type { NewProject, ProjectRecord, ProjectRepo } from "./repo.ts";
export type { ProjectsService } from "./service.ts";
export type { GroupProjectsResult } from "./group-visibility.ts";
export {
  PROJECT_CREATED,
  PROJECT_UPDATED,
  VISIBILITY_CHANGED,
  projectCreatedPayload,
  projectUpdatedPayload,
  visibilityChangedPayload,
} from "./events.ts";
export type { Caller, GroupExists, Visibility } from "./shared.ts";
// 范围的形状跟着仓储走（repo.ts 定义，shared.ts 的判定交出它）；转出口给测试换桩用。
export type { VisibilityScope } from "./repo.ts";
export type {
  CreateProjectInput,
  CreateProjectResult,
  ProjectDetail,
  ProjectsLog,
  ProjectsServiceDeps,
  UpdateProjectInput,
  UpdateProjectResult,
} from "./shared.ts";
