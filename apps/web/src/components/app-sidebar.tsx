import {
  SidebarBrand,
  SidebarFooter,
  SidebarLabel,
  SidebarNav,
  sidebarItemClass,
  ThemeToggle,
  type ToastItem,
} from "@nexus/ui-kit";
import { Link, useMatch } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { AccountMenu } from "./account-menu.tsx";
import { BrandMark } from "./brand-mark.tsx";
import { useCurrentUser } from "../lib/session.ts";

/** 导航。现在只有一组一项；以后的页面按组往里加，侧栏的样子不变。 */
const NAV_GROUPS = [
  {
    label: "平台",
    items: [{ to: "/", label: "系统状态", icon: Activity }],
  },
] as const;

type NavItem = (typeof NAV_GROUPS)[number]["items"][number];

/** 导航里的一项：整条是一个链接，当前所在的这一项高亮。 */
function SidebarLink({ to, label, icon: Icon }: NavItem) {
  const here = useMatch({ from: to, shouldThrow: false });
  return (
    <Link to={to} className={sidebarItemClass({ active: here !== null && here !== undefined })}>
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
            {group.items.map((item) => (
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
