/**
 * 工程这件事会回的三个失败码（规格的错误码表，2026-11-27）。
 * 模块的处理函数从这里拿，免得同一个码在两处各写一份字面量、日后改漏一处。
 * `invalid_request`、`not_found`、`internal_error`、`auth_required` 是全平台已有的，不在这张表里。
 */
export const projectsErrorCodes = {
  /** 新建时短名已被占用（409）。 */
  slugTaken: "projects_slug_taken",
  /** 改一个看得见、但不是自己建的工程，又不是管理员（403）。 */
  forbidden: "projects_forbidden",
  /** 仓库没建起来，或者记录写不进库；已回到什么都没发生过（500，规格 P-20）。 */
  creationFailed: "projects_creation_failed",
} as const;
