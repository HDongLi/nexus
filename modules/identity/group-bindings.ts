import { bind, fail, requireUser, type AnyRouteBinding, type AppEnv } from "@nexus/http-kit";
import type { Context } from "hono";
import { toGroup, type GroupRejection } from "./groups.ts";
import {
  createGroupRoute,
  deleteGroupRoute,
  getGroupRoute,
  listGroupsRoute,
  renameGroupRoute,
  replaceMembersRoute,
} from "./group-routes.ts";
import { identityErrorCodes } from "./codes.ts";
import type { IdentityService } from "./service.ts";
import type { RequestTrace } from "./shared.ts";

/**
 * 用户组的六条路由，绑到用例上（人员规格 G-25 到 G-30，2026-11-28）。
 * 处理函数只做三件事：解析入参、调用用例、把结果交回去。index.ts 把这份清单汇进模块。
 */

const NOT_FOUND_MESSAGE = "没有这个用户组";

/** 组的拒绝怎么回：形状回 400，撞名回 409，不存在的成员回 400（规格 G-25、G-27）。 */
function groupRejection(c: Context<AppEnv>, reason: GroupRejection): Response {
  if (reason === "name_taken") {
    return fail(c, 409, identityErrorCodes.groupNameTaken, "这个组名已经有人用了");
  }
  if (reason === "unknown_member") {
    return fail(c, 400, "invalid_request", "成员里有不存在的账号");
  }
  return fail(c, 400, "invalid_request", "组名不合规");
}

export function groupBindings(
  service: IdentityService,
  trace: (c: Context<AppEnv>) => RequestTrace,
): AnyRouteBinding[] {
  const notFound = (c: Context<AppEnv>) => fail(c, 404, "not_found", NOT_FOUND_MESSAGE);
  return [
    bind(listGroupsRoute, async (c) => {
      const groups = await service.listGroups();
      return c.json({ groups: groups.map(toGroup) }, 200);
    }),
    bind(createGroupRoute, async (c) => {
      const result = await service.createGroup({
        ...c.req.valid("json"),
        operatorId: requireUser(c).id,
        ...trace(c),
      });
      if (result.kind === "ok") return c.json({ group: toGroup(result.group) }, 201);
      return groupRejection(c, result.reason);
    }),
    bind(getGroupRoute, async (c) => {
      const group = await service.getGroup(c.req.valid("param").groupId);
      if (!group) return notFound(c);
      return c.json({ group: toGroup(group) }, 200);
    }),
    bind(renameGroupRoute, async (c) => {
      const result = await service.renameGroup({
        ...c.req.valid("json"),
        operatorId: requireUser(c).id,
        groupId: c.req.valid("param").groupId,
        ...trace(c),
      });
      if (result.kind === "ok" || result.kind === "no_change") {
        return c.json({ group: toGroup(result.group) }, 200);
      }
      if (result.kind === "rejected") return groupRejection(c, result.reason);
      return notFound(c);
    }),
    bind(replaceMembersRoute, async (c) => {
      const result = await service.replaceGroupMembers({
        ...c.req.valid("json"),
        operatorId: requireUser(c).id,
        groupId: c.req.valid("param").groupId,
        ...trace(c),
      });
      if (result.kind === "ok" || result.kind === "no_change") {
        return c.json({ group: toGroup(result.group) }, 200);
      }
      if (result.kind === "rejected") return groupRejection(c, result.reason);
      return notFound(c);
    }),
    bind(deleteGroupRoute, async (c) => {
      const result = await service.deleteGroup({
        operatorId: requireUser(c).id,
        groupId: c.req.valid("param").groupId,
        ...trace(c),
      });
      if (result.kind === "ok") return c.json({ ok: true as const }, 200);
      return notFound(c);
    }),
  ];
}
