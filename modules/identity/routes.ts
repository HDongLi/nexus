import { API_PREFIX, currentUser, errors, json, route } from "@nexus/http-kit";
import { z } from "zod";
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
import {
  createGroupRoute,
  deleteGroupRoute,
  getGroupRoute,
  listGroupsRoute,
  renameGroupRoute,
  replaceMembersRoute,
} from "./group-routes.ts";

/**
 * 这个模块的路由声明。只有形状，没有行为：生成契约文档时只读这一个文件，不起数据库。
 *
 * 登录会话四条，访问级别照规格 I-01。登录是公开的：谁都得先能走到门口。其余三条要登录。
 * 旧的 /api/auth/* 路径不保留，打到那儿一律 404（规格 I-03）。
 * 管账号的八条加同事名录在 account-routes.ts，用户组六条在 group-routes.ts（人员规格 G-01）。
 */

/** 用户名 1 到 64 个字符，口令 1 到 128 个字符。多出来的键也算不合形状。 */
export const loginRequest = z.strictObject({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const passwordRequest = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

/** 登录和我是谁都回这一个。令牌不在正文里，只在 HttpOnly cookie 里（规格 I-21）。 */
const userResponse = z.strictObject({ user: currentUser });

const okResponse = z.strictObject({ ok: z.literal(true) });

/**
 * 429 的形状：details 里带还要等的秒数，页面能照着显示「等 N 秒」。
 * 写进契约，是为了让它在类型里看得见：旧系统把秒数只写在文案里，被客户端吞掉了（台账 BUG-2026-11-15-163）。
 */
const lockedOutBody = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: z.strictObject({ retryAfterSeconds: z.number().int().min(1).max(900) }),
  }),
});

/**
 * 会话 cookie 是在响应头里下发的：成功响应上写明，读契约的人不必去翻实现。
 * 属性是 HttpOnly、SameSite=Lax、Path=/、Max-Age=2592000；https 来路另带 Secure（规格 I-19、I-20）。
 */
const SESSION_HEADER_TEXT = {
  issue: "下发会话 cookie nexus_session。值本身就是令牌，只在响应头里，不进正文",
  clear: "清除会话 cookie nexus_session：Max-Age=0，Expires 是过去的时间",
} as const;

function sessionHeader(action: keyof typeof SESSION_HEADER_TEXT) {
  return {
    "Set-Cookie": { description: SESSION_HEADER_TEXT[action], schema: { type: "string" as const } },
  };
}

export const loginRoute = route("public", {
  method: "post",
  path: `${API_PREFIX}/auth/login`,
  operationId: "login",
  summary: "口令登录",
  description:
    "口令对了就种下会话 cookie，并把这个人直接带回来。用户名不存在、账号没有口令、口令不对，回的是同一句话。",
  tags: ["identity"],
  request: {
    body: { required: true, content: { "application/json": { schema: loginRequest } } },
  },
  responses: {
    200: {
      description: "登录成功。会话在 HttpOnly cookie 里，正文不带令牌",
      headers: sessionHeader("issue"),
      content: { "application/json": { schema: userResponse } },
    },
    ...errors(400, 401, 403, 500),
    429: {
      description: "这个用户名被锁定了，稍后再试",
      content: { "application/json": { schema: lockedOutBody } },
    },
  },
});

export const meRoute = route("user", {
  method: "get",
  path: `${API_PREFIX}/auth/me`,
  operationId: "getMe",
  summary: "我是谁",
  tags: ["identity"],
  responses: {
    200: json(userResponse, "当前登录的人"),
    ...errors(401, 500),
  },
});

export const logoutRoute = route("user", {
  method: "post",
  path: `${API_PREFIX}/auth/logout`,
  operationId: "logout",
  summary: "退出登录",
  description: "删掉服务端的会话，并让浏览器丢掉 cookie。被复制走的旧 cookie 随即失效。",
  tags: ["identity"],
  responses: {
    200: {
      description: "已退出。响应头里有一条清除 cookie 的 Set-Cookie",
      headers: sessionHeader("clear"),
      content: { "application/json": { schema: okResponse } },
    },
    ...errors(401, 403, 500),
  },
});

export const passwordRoute = route("user", {
  method: "post",
  path: `${API_PREFIX}/auth/password`,
  operationId: "changePassword",
  summary: "本人改密",
  description:
    "旧口令对了才改。改完这个人别的会话全部失效，当前会话换一枚新令牌下发，不用重新登录。",
  tags: ["identity"],
  request: {
    body: { required: true, content: { "application/json": { schema: passwordRequest } } },
  },
  responses: {
    200: {
      description: "已改。响应头里下发新的会话 cookie",
      headers: sessionHeader("issue"),
      content: { "application/json": { schema: okResponse } },
    },
    ...errors(400, 401, 403, 500),
    429: {
      description: "这个用户名被锁定了，稍后再试",
      content: { "application/json": { schema: lockedOutBody } },
    },
  },
});

/** 契约文档需要的全部内容。 */
export const identityContract = {
  name: "identity",
  routes: [
    loginRoute,
    meRoute,
    logoutRoute,
    passwordRoute,
    listUsersRoute,
    createUserRoute,
    getUserRoute,
    updateUserRoute,
    resetPasswordRoute,
    disableUserRoute,
    enableUserRoute,
    deleteUserRoute,
    listPeopleRoute,
    listGroupsRoute,
    createGroupRoute,
    getGroupRoute,
    renameGroupRoute,
    replaceMembersRoute,
    deleteGroupRoute,
  ],
} as const;
