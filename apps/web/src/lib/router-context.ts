import type { QueryClient } from "@tanstack/react-query";
import type { api } from "./api.ts";

/**
 * 路由器的上下文：路由的闸（beforeLoad）里拿不到 React 的上下文，要用什么就从这里拿。
 * 只有 main.tsx 往里放东西；路由文件只读。
 */
export interface RouterContext {
  api: typeof api;
  queryClient: QueryClient;
}
