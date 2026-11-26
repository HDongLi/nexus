import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

/**
 * 说明列表：「标签 值」成对的竖排，详情页和状态页最常用的形状。
 * 标签用三级的墨，值用一级，两列之间留 32 像素，值一律顶格对齐，读起来像一张窄表。
 */
export function DescriptionList({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDListElement>) {
  return (
    <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-3", className)} {...rest}>
      {children}
    </dl>
  );
}

export function DescriptionTerm({ children }: { children: ReactNode }) {
  return <dt className="text-ink-3">{children}</dt>;
}

export function DescriptionDetail({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <dd className={cn("min-w-0 break-words text-foreground", className)}>{children}</dd>;
}
