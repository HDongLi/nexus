import { API_PREFIX, currentUser, errors, json, route } from "@nexus/http-kit";
import { z } from "zod";
import { DISPLAY_NAME_RULE, USERNAME_PATTERN, displayNameAccepted } from "./names.ts";

/**
 * 管账号的八条路由加同事名录一条（人员规格 G-01 到 G-23，2026-11-28）。只有形状，没有行为：
 * 生成契约文档时只读这一个文件，不起数据库。八条都是 admin；同事名录是 user（非管理员也调得通，G-07）。
 * 旧的 /api/identity/* 路径不保留，打到那儿一律 404（规格 G-03）。
 * 只多依赖一个纯规则的文件（names.ts）：契约和用例校验的是同一条规则，不抄第二遍。
 */

/** Account 恰好七个键（规格「路由与总则」）；isDisabled 读的是停用时间有没有值（规格 G-06）。 */
export const accountSchema = z.strictObject({
  id: z.string().uuid(),
  username: z.string().min(1),
  displayName: z.string(),
  isAdmin: z.boolean(),
  isDisabled: z.boolean(),
  createdAt: z.iso.datetime(),
  passwordChangedAt: z.iso.datetime(),
});

/** 同事名录的每条恰好是身份规格 User 的四个键（规格 G-07）。 */
const personSchema = currentUser;

/** 用户名按 I-34 的式子收；式子写进契约，读契约的人一眼看得到。 */
const username = z
  .string()
  .regex(USERNAME_PATTERN, "用户名只能用字母、数字、下划线和连字符，最长 64 个字符");

/** 口令 1 到 128 个字符；最短长度是配置项，用例里查（规格 G-10，同 I-32 只查长度）。 */
const password = z.string().min(1).max(128);

/** 去掉首尾空白后 0 到 64 个码点，不含控制字符；空串表示没有（规格 G-12）。 */
const displayName = z
  .string()
  .describe(DISPLAY_NAME_RULE)
  .refine(displayNameAccepted, { message: DISPLAY_NAME_RULE });

export const createAccountRequest = z.strictObject({
  username,
  password,
  displayName: displayName.optional(),
  isAdmin: z.boolean().optional(),
});

/** 至少带一个；带了 username 或 isDisabled 一律 400（规格 G-02）。 */
export const updateAccountRequest = z
  .strictObject({ displayName: displayName.optional(), isAdmin: z.boolean().optional() })
  .refine((body) => body.displayName !== undefined || body.isAdmin !== undefined, {
    message: "显示名和管理员位至少带一个",
  });

/** 重置口令：1 到 128 个字符，只查长度（规格 G-14，同 G-10）。 */
export const resetPasswordRequest = z.strictObject({ newPassword: password });

const userId = z.string().uuid();
const userParams = z.strictObject({ userId });
const singleAccount = z.strictObject({ account: accountSchema });
const okResponse = z.strictObject({ ok: z.literal(true) });

export const listUsersRoute = route("admin", {
  method: "get",
  path: `${API_PREFIX}/users`,
  operationId: "listUsers",
  summary: "人员清单",
  description: "全部账号，停用的也在内，按用户名升序。只有管理员。",
  tags: ["identity"],
  responses: {
    200: json(z.strictObject({ accounts: z.array(accountSchema) }), "全部账号，停用的也在内"),
    ...errors(401, 403, 500),
  },
});

export const createUserRoute = route("admin", {
  method: "post",
  path: `${API_PREFIX}/users`,
  operationId: "createUserAccount",
  summary: "建账号",
  description:
    "建出一个启用的账号。显示名没给就是用户名；口令必须给，没有占位号这回事（规格 G-11）。",
  tags: ["identity"],
  request: {
    body: { required: true, content: { "application/json": { schema: createAccountRequest } } },
  },
  responses: {
    201: json(singleAccount, "建好了"),
    ...errors(400, 401, 403, 409, 500),
  },
});

export const getUserRoute = route("admin", {
  method: "get",
  path: `${API_PREFIX}/users/{userId}`,
  operationId: "getUserAccount",
  summary: "查一个账号",
  tags: ["identity"],
  request: { params: userParams },
  responses: {
    200: json(singleAccount, "这个账号"),
    ...errors(401, 403, 404, 500),
  },
});

export const updateUserRoute = route("admin", {
  method: "patch",
  path: `${API_PREFIX}/users/{userId}`,
  operationId: "updateUserAccount",
  summary: "改显示名和管理员位",
  description:
    "显示名和管理员位至少带一个。和原来一样也回 200，这时什么都没动。降级自己回 409；降级最后一个管理员回 409。",
  tags: ["identity"],
  request: {
    params: userParams,
    body: { required: true, content: { "application/json": { schema: updateAccountRequest } } },
  },
  responses: {
    200: json(singleAccount, "改好了"),
    ...errors(400, 401, 403, 404, 409, 500),
  },
});

export const resetPasswordRoute = route("admin", {
  method: "post",
  path: `${API_PREFIX}/users/{userId}/password`,
  operationId: "resetUserPassword",
  summary: "重置口令",
  description:
    "给别的账号重置：换成新散列，这个人登录着的会话全部失效，操作者自己的会话不动。给自己重置回 409。",
  tags: ["identity"],
  request: {
    params: userParams,
    body: { required: true, content: { "application/json": { schema: resetPasswordRequest } } },
  },
  responses: {
    200: json(okResponse, "已重置"),
    ...errors(400, 401, 403, 404, 409, 500),
  },
});

export const disableUserRoute = route("admin", {
  method: "post",
  path: `${API_PREFIX}/users/{userId}/disable`,
  operationId: "disableUserAccount",
  summary: "停用账号",
  description:
    "记下停用时间，这个账号登录着的会话全部失效。停用最后一个管理员回 409；停用自己回 409。",
  tags: ["identity"],
  request: { params: userParams },
  responses: {
    200: json(singleAccount, "已停用"),
    ...errors(401, 403, 404, 409, 500),
  },
});

export const enableUserRoute = route("admin", {
  method: "post",
  path: `${API_PREFIX}/users/{userId}/enable`,
  operationId: "enableUserAccount",
  summary: "启用账号",
  description: "清掉停用时间。之前被吊销的会话不恢复：要用口令重新登录。",
  tags: ["identity"],
  request: { params: userParams },
  responses: {
    200: json(singleAccount, "已启用"),
    ...errors(401, 403, 404, 500),
  },
});

export const deleteUserRoute = route("admin", {
  method: "delete",
  path: `${API_PREFIX}/users/{userId}`,
  operationId: "deleteUserAccount",
  summary: "删账号",
  description:
    "删掉账号、它的全部会话和它在所有用户组里的成员关系。建过工程的账号删不掉（409），只能停用；删自己回 409。",
  tags: ["identity"],
  request: { params: userParams },
  responses: {
    200: json(okResponse, "已删除"),
    ...errors(401, 403, 404, 409, 500),
  },
});

export const listPeopleRoute = route("user", {
  method: "get",
  path: `${API_PREFIX}/people`,
  operationId: "listPeople",
  summary: "同事名录",
  description: "全部启用的账号，每条只有四个键，按用户名升序。登录了就能调，不看是不是管理员。",
  tags: ["identity"],
  responses: {
    200: json(z.strictObject({ people: z.array(personSchema) }), "全部启用的账号"),
    ...errors(401, 500),
  },
});
