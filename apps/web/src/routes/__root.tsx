import { AppShell, ToastViewport } from "@nexus/ui-kit";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { AppSidebar } from "../components/app-sidebar.tsx";
import { NotFoundPage, RouteErrorPage } from "../components/route-fallbacks.tsx";
import { useToasts } from "../components/use-toasts.ts";
import { LOGIN_PATH, isPublicPath, loginSearch, safeRedirectTarget } from "../lib/auth-gate.ts";
import type { RouterContext } from "../lib/router-context.ts";
import { meQuery } from "../lib/session.ts";

export const Route = createRootRouteWithContext<RouterContext>()({
  // 登录的闸：除了公开的页面，进任何页面之前先问一次「我是谁」。问不出来就去登录页，登录后回到这里。
  // 只用 replace：按「后退」不该一次又一次被弹回登录页。
  beforeLoad: async ({ context, location }) => {
    if (isPublicPath(location.pathname)) return;
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch {
      throw redirect({
        to: LOGIN_PATH,
        search: loginSearch(safeRedirectTarget(location.href)),
        replace: true,
      });
    }
  },
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
});

/** 整个应用分两块：登录页不要外壳，其余页面都是「侧栏加内容区」。 */
function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const toasts = useToasts();
  return (
    <>
      <HeadContent />
      {isPublicPath(pathname) ? (
        <Outlet />
      ) : (
        <AppShell sidebar={<AppSidebar onNotice={toasts.show} />}>
          <Outlet />
        </AppShell>
      )}
      <ToastViewport toasts={toasts.items} onDismiss={toasts.dismiss} />
    </>
  );
}
