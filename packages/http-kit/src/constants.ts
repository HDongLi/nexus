/** 接口的路径前缀。破坏性变更才换版本号，旧版本带退役日期（任务书 §8.2）。 */
export const API_PREFIX = "/api/v1";

/**
 * 会话 cookie 的名字。模块读写它、访问闸认它、契约里的鉴权方式也指它，所以只有这一处定义
 * （2026-11-27，身份模块接入时从应用层挪到这里）。
 */
export const SESSION_COOKIE = "nexus_session";
