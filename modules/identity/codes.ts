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

/**
 * 管账号、管用户组会回的五个失败码（人员规格的错误码表，2026-11-28）。
 * 模块的处理函数从这里拿，免得同一个码在两处各写一份字面量、日后改漏一处。
 * `invalid_request`、`not_found`、`internal_error` 是全平台已有的，不在这张表里。
 */
export const identityErrorCodes = {
  /** 建号时用户名已被占用，含只差大小写（409）。 */
  usernameTaken: "identity_username_taken",
  /** 建组或改名时组名已被占用，含只差大小写（409）。 */
  groupNameTaken: "identity_group_name_taken",
  /** 这次改动会让系统没有启用的管理员（409）。 */
  lastAdmin: "identity_last_admin",
  /** 管理员想降级、停用、删除自己，或给自己重置口令（409）。 */
  selfChange: "identity_self_change",
  /** 要删的账号建过工程；库的引用约束拒绝的，这里只把它翻译成人话（409，规格 G-21）。 */
  userHasProjects: "identity_user_has_projects",
} as const;
