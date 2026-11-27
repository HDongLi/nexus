import type { CurrentUser } from "@nexus/contracts";

/** 所有 HTTP 处理函数共用的上下文变量。 */
export interface AppEnv {
  Variables: {
    /** 每个请求一个，写进响应头 x-request-id，也进日志（实弹条款 3）。 */
    requestId: string;
    /** 当前登录的人，访问闸验过会话之后放进来的。公开路由上没有（2026-11-27，身份模块接入）。 */
    user?: CurrentUser;
  };
}
