import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

/**
 * 清单：一列可点的行。行的壳、头像、主列、右侧辅助信息都在这里，页面只负责把路由器的链接
 * 铺在行上（ui-kit 不认路由器，整行可点这件事由页面用 Link 的 className 完成）。
 * 形状照侧栏的先例：类名可单独导出，结构靠小组件拼。
 */
export function ItemList({ className, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("space-y-0.5", className)} {...rest} />;
}

/** 清单里一行的壳。铺在页面自己的链接上（<Link className={itemRowClass()}>）。 */
export function itemRowClass(): string {
  return cn(
    "flex w-full items-center gap-3 rounded-control px-3 py-2 text-left outline-none",
    "transition-colors duration-150 hover:bg-fill focus-visible:ring-2 focus-visible:ring-ring/50",
  );
}

/** 行首的圆形头像字。一到两个字符；两个字符时字号落一档，免得挤出圆外。 */
export function ItemAvatar({ letter, className }: { letter: ReactNode; className?: string }) {
  const twoUp = typeof letter === "string" && Array.from(letter).length > 1;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 select-none items-center justify-center rounded-full bg-fill-strong font-semibold text-foreground",
        twoUp ? "text-caption" : "text-ui",
        className,
      )}
    >
      {letter}
    </span>
  );
}

/** 行的主列：一行标题，底下一行辅助信息。都截断，长的以省略号收尾，不把行撑高。 */
export function ItemMain({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-ui font-medium text-foreground">{title}</div>
      {subtitle !== undefined ? (
        <div className="truncate text-caption text-ink-3">{subtitle}</div>
      ) : null}
    </div>
  );
}

/** 行右侧的辅助信息（时间这类）。窄屏时由页面把它折进主列。 */
export function ItemMeta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("shrink-0 text-caption tabular-nums text-ink-3", className)}>{children}</div>
  );
}
