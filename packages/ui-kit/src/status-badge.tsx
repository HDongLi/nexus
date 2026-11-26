import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export type StatusTone = "ok" | "fail" | "warn" | "neutral";

const BADGE: Record<StatusTone, string> = {
  ok: "bg-success/10 text-success",
  fail: "bg-destructive/10 text-destructive",
  warn: "bg-warning/12 text-warning",
  neutral: "bg-fill text-ink-2",
};

const DOT: Record<StatusTone, string> = {
  ok: "bg-success",
  fail: "bg-destructive",
  warn: "bg-warning",
  neutral: "bg-ink-4",
};

/**
 * 状态标记：一个圆点加一个词。颜色只用来表状态，不当装饰。
 * 文案要写清楚（「正常」「失败」），圆点是给色觉障碍之外的第二重提示，不是唯一的提示。
 */
export function StatusBadge({
  tone,
  className,
  children,
}: {
  tone: StatusTone;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-px text-caption leading-5 font-medium",
        BADGE[tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}
