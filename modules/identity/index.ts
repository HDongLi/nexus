import {
  SESSION_COOKIE,
  bind,
  fail,
  requireUser,
  type AnyRouteBinding,
  type AppEnv,
} from "@nexus/http-kit";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { authErrorCodes } from "./codes.ts";
import { sessionCookie, type SessionCookie } from "./cookies.ts";
import { loginRoute, logoutRoute, meRoute, passwordRoute } from "./routes.ts";
import { createIdentityService, type IdentityService } from "./service.ts";
import type { IdentityServiceDeps, RequestTrace } from "./shared.ts";

/** 来源地址怎么从一个 HTTP 请求里取。应用层知道请求经过哪台代理，模块不知道，所以由应用传进来。 */
export type ClientIp = (c: Context<AppEnv>) => string;

export interface IdentityModuleDeps extends IdentityServiceDeps {
  clientIp: ClientIp;
}

/** 模块交给应用挂载的东西：绑好处理函数的路由，加用例。 */
export interface IdentityModule {
  bindings: readonly AnyRouteBinding[];
  service: IdentityService;
  /** 访问闸续期之后要重发 cookie，从这里拿同一份属性，不在应用层再写一遍。 */
  sessionCookie: SessionCookie;
}

/**
 * 本模块唯一出口（任务书 §5.3）。别的模块和应用只准 import 这一个文件，
 * 依赖方向检查会拦下伸进来的手。处理函数只做三件事：解析入参、调用用例、把结果交回去。
 */
export function createIdentityModule(deps: IdentityModuleDeps): IdentityModule {
  const service = createIdentityService(deps);
  const trace = (c: Context<AppEnv>): RequestTrace => ({
    ip: deps.clientIp(c),
    traceId: c.get("requestId"),
  });
  // 退出和改密要知道「是哪一条会话」：上下文里只有当前用户，所以从 cookie 里再取一次令牌。
  const token = (c: Context<AppEnv>): string => getCookie(c, SESSION_COOKIE) ?? "";
  const locked = (c: Context<AppEnv>, seconds: number) =>
    fail(c, 429, authErrorCodes.lockedOut, "这个用户名试错次数太多，稍后再试", {
      retryAfterSeconds: seconds,
    });

  return {
    service,
    sessionCookie,
    bindings: [
      bind(loginRoute, async (c) => {
        const result = await service.login({ ...c.req.valid("json"), ...trace(c) });
        if (result.kind === "ok") {
          sessionCookie.set(c, result.token);
          return c.json({ user: result.user }, 200);
        }
        if (result.kind === "locked") return locked(c, result.retryAfterSeconds);
        if (result.kind === "disabled")
          return fail(c, 403, authErrorCodes.accountDisabled, "账号已停用，找管理员");
        return fail(c, 401, authErrorCodes.invalidCredentials, "用户名或口令不对");
      }),
      bind(meRoute, async (c) => c.json({ user: requireUser(c) }, 200)),
      bind(logoutRoute, async (c) => {
        await service.logout({ token: token(c), ...trace(c) });
        sessionCookie.clear(c);
        return c.json({ ok: true as const }, 200);
      }),
      bind(passwordRoute, async (c) => {
        const result = await service.changePassword({
          ...c.req.valid("json"),
          token: token(c),
          ...trace(c),
        });
        switch (result.kind) {
          case "ok":
            sessionCookie.set(c, result.token);
            return c.json({ ok: true as const }, 200);
          case "no_session":
            return fail(c, 401, authErrorCodes.required, "登录已失效，请重新登录");
          case "locked":
            return locked(c, result.retryAfterSeconds);
          case "current_password_wrong":
            return fail(c, 400, authErrorCodes.currentPasswordWrong, "旧口令不对");
          case "too_weak":
            return fail(
              c,
              400,
              authErrorCodes.passwordTooWeak,
              `新口令太短，至少 ${deps.passwordMinLength} 个字符`,
            );
          case "reused":
            return fail(c, 400, authErrorCodes.passwordReused, "新口令和旧口令一样，换一个");
        }
      }),
    ],
  };
}

export { authErrorCodes } from "./codes.ts";
export {
  LOGIN_FAILED,
  LOGIN_SUCCEEDED,
  LOGOUT,
  PASSWORD_CHANGED,
  USER_CREATED,
  loginFailedPayload,
  loginSucceededPayload,
  logoutPayload,
  passwordChangedPayload,
  userCreatedPayload,
} from "./events.ts";
export { USERNAME_PATTERN } from "./accounts.ts";
export { SESSION_MAX_AGE_SECONDS } from "./cookies.ts";
export { identityContract, loginRequest, passwordRequest } from "./routes.ts";
export { argon2PasswordHasher } from "./password.ts";
export type { Argon2, PasswordHasher } from "./password.ts";
export { createIdentityRepo } from "./repo.ts";
export { createIdentityService } from "./service.ts";
export type { LoginFailedReason } from "./events.ts";
export type {
  AuthenticatedSession,
  ChangePasswordResult,
  CreateUserRejection,
  CreateUserResult,
  IdentityServiceDeps,
  LoginResult,
  RequestTrace,
} from "./shared.ts";
export type { IdentityRepo, NewSession, NewUser, SessionRecord, UserRecord } from "./repo.ts";
export type { IdentityService };
