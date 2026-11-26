import { createApiClient } from "@nexus/api-client";

/** 全应用唯一的一个接口客户端。页面不自己拼请求。 */
export const api = createApiClient();
