import {
  SidebarBrand,
  SidebarFooter,
  SidebarLabel,
  SidebarNav,
  sidebarItemClass,
  ThemeToggle,
  type ToastItem,
} from "@nexus/ui-kit";
import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, FolderGit2, Users, UsersRound, type LucideIcon } from "lucide-react";
import { AccountMenu } from "./account-menu.tsx";
import { BrandMark } from "./brand-mark.tsx";
import { useCurrentUser } from "../lib/session.ts";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** exact 为真的一项只在自己那一页亮（首页是所有路径的前缀，必须逐字比）；其余的按前缀比：详情页也算在「工程」项里。 */
  exact: boolean;
  /**
   * 只有管理员看得到（「我是谁」里的 isAdmin）。管理动作的闸在后端接口层，前端只是不画入口；
   * 非管理员直接输地址，页面给「需要管理员」的挡板卡（规格 G-42）。
   */
  adminOnly?: boolean;
}

/**
 * 导航。平台一组放整个应用都要的页面；开发一组放开发面的业务页，往后第 4、5、6 片按组往里加，
 * 侧栏的样子不变。
 */
const NAV_GROUPS: { label: string; items: readonly NavItem[] }[] = [
  {
    label: "平台",
    items: [{ to: "/", label: "系统状态", icon: Activity, exact: true }],
  },
  {
    label: "开发",
    items: [
      { to: "/projects", label: "工程", icon: FolderGit2, exact: false },
      { to: "/people", label: "人员", icon: Users, exact: false, adminOnly: true },
      { to: "/groups", label: "用户组", icon: UsersRound, exact: false, adminOnly: true },
    ],
  },
];

/** 导航里的一项：整条是一个链接，当前所在的这一项高亮。 */
function SidebarLink({ to, label, icon: Icon, exact }: NavItem) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = exact ? pathname === to : pathname.startsWith(to);
  return (
    <Link to={to} className={sidebarItemClass({ active })}>
      <Icon />
      {label}
    </Link>
  );
}

/** 整个应用共用的一条侧栏：标志和主题、导航、底下的当前用户。 */
export function AppSidebar({
  onNotice,
}: {
  /** 右下角的常显提示。侧栏里做的事（改口令）做成了，从这里告诉人。 */
  onNotice: (toast: Omit<ToastItem, "id">) => void;
}) {
  const currentUser = useCurrentUser();
  const isAdmin = currentUser.data?.isAdmin ?? false;
  return (
    <>
      <SidebarBrand>
        <BrandMark />
        <span className="text-body font-semibold tracking-tight">nexus</span>
        <ThemeToggle className="ml-auto" />
      </SidebarBrand>
      <SidebarNav label="主导航">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <SidebarLabel>{group.label}</SidebarLabel>
            {group.items
              .filter((item) => !item.adminOnly || isAdmin)
              .map((item) => (
                <SidebarLink key={item.to} {...item} />
              ))}
          </div>
        ))}
      </SidebarNav>
      <SidebarFooter>
        {currentUser.data !== undefined ? (
          <AccountMenu user={currentUser.data} onNotice={onNotice} />
        ) : null}
      </SidebarFooter>
    </>
  );
}
