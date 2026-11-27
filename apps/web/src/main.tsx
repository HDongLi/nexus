import { ThemeProvider } from "@nexus/ui-kit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@nexus/ui-kit/styles.css";
import { api } from "./lib/api.ts";
import type { RouterContext } from "./lib/router-context.ts";
import { routeTree } from "./routeTree.gen.ts";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } },
});

// 查询客户端放进路由器的上下文：路由的闸（beforeLoad）里拿不到 React 的上下文，要用就从这里拿。
const context: RouterContext = { api, queryClient };
const router = createRouter({ routeTree, context });

// 让整个应用里的类型都从这一个路由实例推导（路径、参数、上下文全部有类型）。
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("页面上找不到 #root");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
