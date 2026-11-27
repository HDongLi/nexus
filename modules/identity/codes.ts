/**
 * 身份这件事会回的失败码（规格的错误码表，2026-11-27）。
 * 模块的处理函数、应用层的访问闸和来源校验都从这里拿，免得同一个码在两处各写一份字面量、日后改漏一处。
 * `invalid_request`、`not_found`、`internal_error` 是全平台已有的，不在这张表里。
 */
export const authErrorCodes = {
  /** 没登录、会话失效或已被吊销（401）。 */
  required: "auth_required",
  /** 登录时用户名或口令不对，两种情形同一个回应（401）。 */
  invalidCredentials: "auth_invalid_credentials",
  /** 用户名处于锁定（429）。 */
  lockedOut: "auth_locked_out",
  /** 已登录但级别不够（403）。 */
  forbidden: "auth_forbidden",
  /** 登录时口令正确，但账号已停用（403）。 */
  accountDisabled: "auth_account_disabled",
  /** 写请求的 Origin 与对外地址不一致，或者是 null（403）。 */
  originMismatch: "csrf_origin_mismatch",
  /** 改密时旧口令不对（400）。 */
  currentPasswordWrong: "auth_current_password_wrong",
  /** 新口令短于最短长度（400）。 */
  passwordTooWeak: "auth_password_too_weak",
  /** 新口令与旧口令相同（400）。 */
  passwordReused: "auth_password_reused",
} as const;
