import {
  AppShell,
  SidebarBrand,
  SidebarFooter,
  SidebarItem,
  SidebarLabel,
  SidebarNav,
} from "@nexus/ui-kit";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Activity } from "lucide-react";

export const Route = createRootRoute({
  // 整个应用共用一副框架：导航栏在这里配一次，各路由只管自己的内容区。
  component: () => (
    <AppShell sidebar={<AppSidebar />}>
      <Outlet />
    </AppShell>
  ),
});

/** 标志：一个环加一个心点，「枢纽」的意思。只用强调色，不用渐变。 */
function BrandMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="size-5 shrink-0 text-primary"
      fill="none"
    >
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="10" cy="10" r="2.5" fill="currentColor" />
    </svg>
  );
}

function AppSidebar() {
  return (
    <>
      <SidebarBrand>
        <BrandMark />
        <span className="text-body font-semibold tracking-tight">nexus</span>
      </SidebarBrand>
      <SidebarNav label="主导航">
        <SidebarLabel>平台</SidebarLabel>
        <SidebarItem active>
          <Activity />
          系统状态
        </SidebarItem>
      </SidebarNav>
      <SidebarFooter>登录尚未接入</SidebarFooter>
    </>
  );
}
