import { API_PREFIX, errors, json, route } from "@nexus/http-kit";
import { z } from "zod";
import { AVATAR_RULE, avatarAccepted, DISPLAY_NAME_RULE, displayNameAccepted } from "./names.ts";
import { SLUG_PATTERN, SLUG_RULE } from "./slug.ts";

/**
 * 这个模块的路由声明。只有形状，没有行为：生成契约文档时只读这一个文件，不起数据库。
 *
 * 四条路由，访问级别都是 user（规格 P-01）：新建不看是不是管理员，登录了就能建（规格 P-14）。
 * 旧的 /api/projects/* 路径不保留，打到那儿一律 404（规格 P-03）。
 * 这里只多依赖两个纯规则的文件（slug.ts、names.ts）：契约和用例校验的是同一条规则，不抄第二遍。
 */

const id = z.string().uuid();

/** 按原样收，不去空白、不改大小写（规格 P-13）。式子写进契约，读契约的人一眼看得到。 */
const slug = z.string().regex(SLUG_PATTERN, SLUG_RULE);

/** 去掉首尾空白后 0 到 40 个码点，不含控制字符；空串表示没有（规格 P-27）。 */
const displayName = z
  .string()
  .describe(DISPLAY_NAME_RULE)
  .refine(displayNameAccepted, { message: DISPLAY_NAME_RULE });

/** 去掉首尾空白后 0 到 2 个码点，不含空白和控制字符；空串表示没有（规格 P-28）。 */
const avatar = z.string().describe(AVATAR_RULE).refine(avatarAccepted, { message: AVATAR_RULE });

/** 恰好七个键，都是字符串；时间是带时区的 ISO 8601（规格「路由与总则」）。 */
export const projectSchema = z.strictObject({
  id,
  slug,
  displayName: z.string(),
  avatar: z.string(),
  /** 创建者的账号编号。 */
  createdById: id,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** 记录加默认分支最新一次提交（规格 P-25）。 */
export const projectDetailSchema = projectSchema.extend({
  head: z.strictObject({
    commitId: z.string().min(1),
    committedAt: z.iso.datetime(),
    subject: z.string(),
  }),
});

export const createProjectRequest = z.strictObject({
  slug,
  displayName: displayName.optional(),
  avatar: avatar.optional(),
});

/** 至少带一个；带了 slug 或别的键一律 400（规格 P-32、P-02）。 */
export const updateProjectRequest = z
  .strictObject({ displayName: displayName.optional(), avatar: avatar.optional() })
  .refine((body) => body.displayName !== undefined || body.avatar !== undefined, {
    message: "显示名和头像字至少带一个",
  });

const projectParams = z.strictObject({ projectId: id });

const single = z.strictObject({ project: projectSchema });

export const listRoute = route("user", {
  method: "get",
  path: `${API_PREFIX}/projects`,
  operationId: "listProjects",
  summary: "工程清单",
  description: "只回当前登录的人看得见的工程，新的在前。只读记录，不跑 git。",
  tags: ["projects"],
  responses: {
    200: json(z.strictObject({ projects: z.array(projectSchema) }), "看得见的工程，新的在前"),
    ...errors(401, 500),
  },
});

export const createRoute = route("user", {
  method: "post",
  path: `${API_PREFIX}/projects`,
  operationId: "createProject",
  summary: "新建工程",
  description:
    "登录了就能建。建成时平台已经建好裸仓库并做了初始提交，默认分支是 main。短名全平台唯一，建后不改。",
  tags: ["projects"],
  request: {
    body: { required: true, content: { "application/json": { schema: createProjectRequest } } },
  },
  responses: {
    201: json(single, "建成了，仓库已可用"),
    ...errors(400, 401, 403, 409, 500),
  },
});

export const detailRoute = route("user", {
  method: "get",
  path: `${API_PREFIX}/projects/{projectId}`,
  operationId: "getProject",
  summary: "工程详情",
  description: "记录，加默认分支最新一次提交。看不见和不存在回得一样，都是 404。",
  tags: ["projects"],
  request: { params: projectParams },
  responses: {
    200: json(z.strictObject({ project: projectDetailSchema }), "工程和它的最新提交"),
    ...errors(401, 404, 500),
  },
});

export const updateRoute = route("user", {
  method: "patch",
  path: `${API_PREFIX}/projects/{projectId}`,
  operationId: "updateProject",
  summary: "改显示名和头像字",
  description:
    "只有创建者和管理员能改。显示名和头像字至少带一个，空串就是清除。和原来一样也回 200，这时什么都没动。",
  tags: ["projects"],
  request: {
    params: projectParams,
    body: { required: true, content: { "application/json": { schema: updateProjectRequest } } },
  },
  responses: {
    200: json(single, "改好了"),
    ...errors(400, 401, 403, 404, 500),
  },
});

/** 契约文档需要的全部内容。 */
export const projectsContract = {
  name: "projects",
  routes: [listRoute, createRoute, detailRoute, updateRoute],
} as const;
