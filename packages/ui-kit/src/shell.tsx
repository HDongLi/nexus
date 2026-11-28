import { cva, type VariantProps } from "class-variance-authority";
import { PanelLeft, X } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "./cn.ts";

/* 窄于 768 像素时导航栏收进抽屉，和样式表里的 md 断点保持一致。 */
const NARROW_QUERY = "(max-width: 47.99rem)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = (): void => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

interface ShellState {
  /** 只在窄屏下有意义：导航栏此刻是不是拉开着。 */
  navOpen: boolean;
  toggleNav: () => void;
}

const ShellContext = createContext<ShellState | null>(null);

/**
 * 应用框架：左边一条固定的导航栏，右边是滚动的内容区。
 * 四家做得好看的对话类产品在这一点上完全一致：侧栏 240 像素左右、不随内容伸缩；
 * 内容区自己限宽居中，行宽不超过大约 800 像素（决策记录 0004）。
 * 窄于 768 像素时导航栏收进抽屉，由页头上的按钮拉开；固定宽度的侧栏会把内容区挤成一条，
 * 整页竖着折起来（2026-11-26 实测 430 像素宽）。
 */
export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const narrow = useNarrow();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const state: ShellState = {
    navOpen: narrow && navOpen,
    toggleNav: () => setNavOpen((open) => !open),
  };

  return (
    <ShellContext.Provider value={state}>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        {narrow && navOpen ? (
          // 遮罩只给鼠标和手指用，不进 Tab 的顺序：键盘关抽屉用 Esc 或者页头上那个按钮。
          <button
            type="button"
            tabIndex={-1}
            aria-label="收起导航"
            className="fixed inset-0 z-30 bg-overlay"
            onClick={() => setNavOpen(false)}
          />
        ) : null}
        <aside
          // 点了导航里的任何一项就把抽屉收回去。只认导航（nav）里的链接和按钮：
          // 顶上的主题按钮、底下的账号按钮点开的是菜单和对话框，抽屉要留着（2026-11-27）。
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("nav a, nav button")) setNavOpen(false);
          }}
          className={cn(
            "flex w-60 shrink-0 flex-col border-r border-border bg-surface",
            narrow &&
              "fixed inset-y-0 left-0 z-40 border-r-0 transition-transform duration-200 ease-out",
            narrow && (navOpen ? "translate-x-0 shadow-prominent" : "-translate-x-full"),
          )}
        >
          {sidebar}
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </ShellContext.Provider>
  );
}

export function SidebarBrand({ children, className }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex h-14 shrink-0 items-center gap-2.5 px-4", className)}>{children}</div>
  );
}

export function SidebarNav({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <nav aria-label={label} className={cn("space-y-0.5 px-2", className)}>
      {children}
    </nav>
  );
}

/** 分组的小标题。字号不变、颜色变浅，所以它和条目是对齐的，不用缩进。 */
export function SidebarLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-4 pb-1.5 text-ink-3">{children}</div>;
}

export const sidebarItemVariants = cva(
  "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-ink-2 transition-colors duration-150 outline-none hover:bg-fill hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      active: {
        true: "bg-fill-strong font-medium text-foreground",
        false: "",
      },
    },
  },
);

export function sidebarItemClass(options?: VariantProps<typeof sidebarItemVariants>) {
  return sidebarItemVariants(options);
}

export interface SidebarItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** 默认渲染成按钮；给了 href 就渲染成链接。接路由时用 sidebarItemClass 配自己的 Link。 */
  href?: string;
}

export function SidebarItem({
  active,
  className,
  href,
  children,
  // 按钮的类型固定是 button，调用方传进来的 type 只解构出来，不往下透传。
  type: _type,
  ...props
}: SidebarItemProps) {
  const classes = sidebarItemVariants({ active });
  if (href !== undefined) {
    return (
      <a
        href={href}
        className={cn(classes, className)}
        {...(props as AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cn(classes, className)} {...props}>
      {children}
    </button>
  );
}

/** 侧栏的底部：放当前用户的入口。文字的字号和颜色由放进来的东西自己带。 */
export function SidebarFooter({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-auto flex items-center border-t border-border p-2", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * 抽屉收起的那一刻，焦点要是还留在里面（它整个被挪到窗口外面了），接回拉开它的按钮。
 * 抽屉里有账号菜单这类点了不收抽屉的东西，所以「焦点在抽屉里、按 Esc 收抽屉」是走得通的路（2026-11-27）。
 */
function useTakeFocusBack(open: boolean, target: RefObject<HTMLButtonElement | null>): void {
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    const active = document.activeElement;
    if (closed && active instanceof HTMLElement && active.closest("aside") !== null)
      target.current?.focus();
  }, [open, target]);
}

/**
 * 页头：吸顶的一行，左边标题，右边动作。标题用 16 号半粗，和面板标题拉开一档就够，
 * 不做很大的页面大标题：这里是需要每天用的工具，不是宣传页。
 * 窄屏下最左边多一个按钮，用来拉开导航抽屉。
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const shell = useContext(ShellContext);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useTakeFocusBack(shell?.navOpen ?? false, toggleRef);
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/90 px-5 backdrop-blur md:px-8">
      <div className="flex min-w-0 items-center gap-2">
        {shell ? (
          <button
            ref={toggleRef}
            type="button"
            aria-label={shell.navOpen ? "收起导航" : "展开导航"}
            aria-expanded={shell.navOpen}
            onClick={shell.toggleNav}
            className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-2 outline-none transition-colors hover:bg-fill hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:hidden [&_svg]:size-5"
          >
            {shell.navOpen ? <X /> : <PanelLeft />}
          </button>
        ) : null}
        <h1 className="truncate text-body font-semibold">{title}</h1>
        {/* 说明是一句要读的话，用二级墨（三级墨的对比度不够写句子）。只在宽屏显示：窄屏时它会把标题挤没。 */}
        {description !== undefined ? (
          <p className="hidden min-w-0 truncate text-ink-2 lg:block">{description}</p>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

/** 页面内容的容器。读的内容用默认的窄版心；表格类页面传 wide。 */
export function PageBody({
  wide = false,
  className,
  children,
}: {
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full space-y-4 px-5 py-6 md:px-8 md:py-8",
        wide ? "max-w-(--container-wide)" : "max-w-(--container-read)",
        className,
      )}
    >
      {children}
    </div>
  );
}
