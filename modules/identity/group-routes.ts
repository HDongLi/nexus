import { API_PREFIX, errors, json, route } from "@nexus/http-kit";
import { z } from "zod";
import { GROUP_NAME_RULE, groupNameAccepted } from "./names.ts";

/**
 * 用户组的六条路由（人员规格 G-01、G-25 到 G-30，2026-11-28）。只有形状，没有行为。
 * 都是 admin。一个组的可见工程那两条不在这里：关系表归工程模块，路由也归它（规格 G-31）。
 */

/** Group 恰好五个键（规格「路由与总则」）；memberIds 没有重复，顺序不表示什么。 */
export const groupSchema = z.strictObject({
  id: z.string().uuid(),
  name: z.string().min(1),
  memberIds: z.array(z.string().uuid()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** 去掉首尾空白后 1 到 64 个码点，不含控制字符（规格 G-25）。 */
const groupName = z
  .string()
  .describe(GROUP_NAME_RULE)
  .refine(groupNameAccepted, { message: GROUP_NAME_RULE });

/** 编号的数组，没有重复；重复的编号算形状不合（规格 G-02）。 */
const uniqueIds = (rule: string) =>
  z.array(z.string().uuid()).refine((ids) => new Set(ids).size === ids.length, rule);

const groupId = z.string().uuid();
const groupParams = z.strictObject({ groupId });
const singleGroup = z.strictObject({ group: groupSchema });
const okResponse = z.strictObject({ ok: z.literal(true) });

export const createGroupRequest = z.strictObject({
  name: groupName,
  memberIds: uniqueIds("成员里有重复的编号").optional(),
});

export const renameGroupRequest = z.strictObject({ name: groupName });

/** 整体替换成员：请求里的集合换掉原来的（规格 G-28）。 */
export const replaceMembersRequest = z.strictObject({
  userIds: uniqueIds("成员里有重复的编号"),
});

export const listGroupsRoute = route("admin", {
  method: "get",
  path: `${API_PREFIX}/groups`,
  operationId: "listGroups",
  summary: "用户组清单",
  description: "全部用户组，创建早的在前，每组带成员编号。只有管理员。",
  tags: ["identity"],
  responses: {
    200: json(z.strictObject({ groups: z.array(groupSchema) }), "全部用户组，创建早的在前"),
    ...errors(401, 403, 500),
  },
});

export const createGroupRoute = route("admin", {
  method: "post",
  path: `${API_PREFIX}/groups`,
  operationId: "createUserGroup",
  summary: "建用户组",
  description:
    "组名不分大小写全平台唯一。成员没给就是空组；成员必须是存在的账号，停用的也算存在。建组不带可见的工程。",
  tags: ["identity"],
  request: {
    body: { required: true, content: { "application/json": { schema: createGroupRequest } } },
  },
  responses: {
    201: json(singleGroup, "建好了"),
    ...errors(400, 401, 403, 409, 500),
  },
});

export const getGroupRoute = route("admin", {
  method: "get",
  path: `${API_PREFIX}/groups/{groupId}`,
  operationId: "getUserGroup",
  summary: "查一个用户组",
  tags: ["identity"],
  request: { params: groupParams },
  responses: {
    200: json(singleGroup, "这个用户组"),
    ...errors(401, 403, 404, 500),
  },
});

export const renameGroupRoute = route("admin", {
  method: "patch",
  path: `${API_PREFIX}/groups/{groupId}`,
  operationId: "renameUserGroup",
  summary: "改组名",
  description: "名字没变也回 200，这时什么都没动。成员和可见的工程不动。",
  tags: ["identity"],
  request: {
    params: groupParams,
    body: { required: true, content: { "application/json": { schema: renameGroupRequest } } },
  },
  responses: {
    200: json(singleGroup, "改好了"),
    ...errors(400, 401, 403, 404, 409, 500),
  },
});

export const replaceMembersRoute = route("admin", {
  method: "put",
  path: `${API_PREFIX}/groups/{groupId}/members`,
  operationId: "replaceGroupMembers",
  summary: "整体替换成员",
  description: "请求里的集合换掉原来的集合。和原来一样（不看顺序）也回 200，这时什么都没动。",
  tags: ["identity"],
  request: {
    params: groupParams,
    body: { required: true, content: { "application/json": { schema: replaceMembersRequest } } },
  },
  responses: {
    200: json(singleGroup, "换好了"),
    ...errors(400, 401, 403, 404, 500),
  },
});

export const deleteGroupRoute = route("admin", {
  method: "delete",
  path: `${API_PREFIX}/groups/{groupId}`,
  operationId: "deleteUserGroup",
  summary: "删用户组",
  description: "删掉组，不删账号，也不删工程。组看得见的工程随之不可见；不要求组是空的。",
  tags: ["identity"],
  request: { params: groupParams },
  responses: {
    200: json(okResponse, "已删除"),
    ...errors(401, 403, 404, 500),
  },
});
