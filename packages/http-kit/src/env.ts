/** 所有 HTTP 处理函数共用的上下文变量。 */
export interface AppEnv {
  Variables: {
    /** 每个请求一个，写进响应头 x-request-id，也进日志（实弹条款 3）。 */
    requestId: string;
  };
}
