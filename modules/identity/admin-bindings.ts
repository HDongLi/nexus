import { bind, fail, requireUser, type AnyRouteBinding, type AppEnv } from "@nexus/http-kit";
import type { Context } from "hono";
import { toAccount, type CreateAccountRejection } from "./admin-accounts.ts";
import {
  createUserRoute,
  deleteUserRoute,
  disableUserRoute,
  enableUserRoute,
  getUserRoute,
  listPeopleRoute,
  listUsersRoute,
  resetPasswordRoute,
  updateUserRoute,
} from "./account-routes.ts";
import { authErrorCodes, identityErrorCodes } from "./codes.ts";
import type { IdentityService } from "./service.ts";
import type { RequestTrace } from "./shared.ts";

/**
 * 管账号的八条路由加同事名录一条，绑到用例上（人员规格 G-06 到 G-23，2026-11-28）。
 * 处理函数只做三件事：解析入参、调用用例、把结果交回去。index.ts 把这份清单汇进模块。
 */

const NOT_FOUND_MESSAGE = "没有这个账号";

/** 建号的拒绝怎么回：形状回 400，撞名回 409（规格 G-09 到 G-11）。 */
function createRejection(
  c: Context<AppEnv>,
  reason: CreateAccountRejection,
  passwordMinLength: number,
): Response {
  if (reason === "username_taken") {
    return fail(c, 409, identityErrorCodes.usernameTaken, "这个用户名已经有人用了");
  }
  if (reason === "password_too_weak") {
    return fail(
      c,
      400,
      authErrorCodes.passwordTooWeak,
      `口令太短，至少 ${String(passwordMinLength)} 个字符`,
    );
  }
  return fail(c, 400, "invalid_request", "用户名或显示名不合规");
}

export function adminAccountBindings(
  service: IdentityService,
  passwordMinLength: number,
  trace: (c: Context<AppEnv>) => RequestTrace,
): AnyRouteBinding[] {
  const notFound = (c: Context<AppEnv>) => fail(c, 404, "not_found", NOT_FOUND_MESSAGE);
  return [
    bind(listUsersRoute, async (c) => {
      const accounts = await service.listAccounts();
      return c.json({ accounts: accounts.map(toAccount) }, 200);
    }),
    bind(createUserRoute, async (c) => {
      const result = await service.createAccount({
        ...c.req.valid("json"),
        isAdmin: c.req.valid("json").isAdmin ?? false,
        operatorId: requireUser(c).id,
        ...trace(c),
      });
      if (result.kind === "ok") return c.json({ account: toAccount(result.user) }, 201);
      return createRejection(c, result.reason, passwordMinLength);
    }),
    bind(getUserRoute, async (c) => {
      const account = await service.getAccount(c.req.valid("param").userId);
      if (!account) return notFound(c);
      return c.json({ account: toAccount(account) }, 200);
    }),
    bind(updateUserRoute, async (c) => {
      const result = await service.updateAccount({
        ...c.req.valid("json"),
        operatorId: requireUser(c).id,
        userId: c.req.valid("param").userId,
        ...trace(c),
      });
      if (result.kind === "ok" || result.kind === "no_change") {
        return c.json({ account: toAccount(result.user) }, 200);
      }
      if (result.kind === "invalid_display_name") {
        return fail(c, 400, "invalid_request", "显示名不合规");
      }
      if (result.kind === "self_change") {
        return fail(c, 409, identityErrorCodes.selfChange, "不能降级自己");
      }
      if (result.kind === "last_admin") {
        return fail(c, 409, identityErrorCodes.lastAdmin, "这是最后一个启用的管理员");
      }
      return notFound(c);
    }),
    bind(resetPasswordRoute, async (c) => {
      const result = await service.resetAccountPassword({
        ...c.req.valid("json"),
        operatorId: requireUser(c).id,
        userId: c.req.valid("param").userId,
        ...trace(c),
      });
      if (result.kind === "ok") return c.json({ ok: true as const }, 200);
      if (result.kind === "too_weak") {
        return fail(
          c,
          400,
          authErrorCodes.passwordTooWeak,
          `口令太短，至少 ${String(passwordMinLength)} 个字符`,
        );
      }
      if (result.kind === "self_change") {
        return fail(c, 409, identityErrorCodes.selfChange, "不能给自己重置口令；要改就走本人改密");
      }
      return notFound(c);
    }),
    bind(disableUserRoute, async (c) => {
      const result = await service.setAccountDisabled({
        operatorId: requireUser(c).id,
        userId: c.req.valid("param").userId,
        disabled: true,
        ...trace(c),
      });
      if (result.kind === "ok" || result.kind === "no_change") {
        return c.json({ account: toAccount(result.user) }, 200);
      }
      if (result.kind === "self_change") {
        return fail(c, 409, identityErrorCodes.selfChange, "不能停用自己");
      }
      if (result.kind === "last_admin") {
        return fail(c, 409, identityErrorCodes.lastAdmin, "这是最后一个启用的管理员");
      }
      return notFound(c);
    }),
    bind(enableUserRoute, async (c) => {
      const result = await service.setAccountDisabled({
        operatorId: requireUser(c).id,
        userId: c.req.valid("param").userId,
        disabled: false,
        ...trace(c),
      });
      if (result.kind === "ok" || result.kind === "no_change") {
        return c.json({ account: toAccount(result.user) }, 200);
      }
      return notFound(c);
    }),
    bind(deleteUserRoute, async (c) => {
      const result = await service.deleteAccount({
        operatorId: requireUser(c).id,
        userId: c.req.valid("param").userId,
        ...trace(c),
      });
      if (result.kind === "ok") return c.json({ ok: true as const }, 200);
      if (result.kind === "self_change") {
        return fail(c, 409, identityErrorCodes.selfChange, "不能删除自己");
      }
      if (result.kind === "last_admin") {
        return fail(c, 409, identityErrorCodes.lastAdmin, "这是最后一个启用的管理员");
      }
      if (result.kind === "has_projects") {
        return fail(
          c,
          409,
          identityErrorCodes.userHasProjects,
          "这个账号建过工程，删不了；要让它进不来就停用",
        );
      }
      return notFound(c);
    }),
    bind(listPeopleRoute, async (c) => {
      const people = await service.listPeople();
      return c.json(
        {
          people: people.map((person) => ({
            id: person.id,
            username: person.username,
            displayName: person.displayName,
            isAdmin: person.isAdmin,
          })),
        },
        200,
      );
    }),
  ];
}
