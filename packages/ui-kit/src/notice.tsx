import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

type Tone = "info" | "error" | "success";

const TONES: Record<Tone, string> = {
  info: "border-border bg-fill",
  error: "border-destructive/25 bg-destructive/6",
  success: "border-success/25 bg-success/6",
};

const ICONS: Record<Tone, ReactNode> = {
  info: <Info className="text-ink-3" />,
  error: <CircleAlert className="text-destructive" />,
  success: <CircleCheck className="text-success" />,
};

const TITLES: Record<Tone, string> = {
  info: "提示",
  error: "出错了",
  success: "成功",
};

export interface NoticeProps {
  tone: Tone;
  /** 覆盖默认标题。 */
  title?: string;
  /** 一行说清怎么办。出错时必填（实弹条款 2：失败要说清楚为什么、怎么办）。 */
  children?: ReactNode;
  /** 出错时的请求号，方便对日志。 */
  requestId?: string;
  className?: string;
}

/**
 * 卡内常显的提示条。页面上的错误一律用它，不用浏览器原生弹窗：
 * 内嵌浏览器里原生对话框点不动，旧仓在这上面栽过四次（实弹条款 2）。
 */
export function Notice({ tone, title, children, requestId, className }: NoticeProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-card border px-4 py-3", TONES[tone], className)}
    >
      <p className="flex items-center gap-2 font-medium [&_svg]:size-4 [&_svg]:shrink-0">
        {ICONS[tone]}
        {title ?? TITLES[tone]}
      </p>
      {children ? <div className="mt-1 pl-6 text-ink-2">{children}</div> : null}
      {tone === "error" && requestId ? (
        <p className="mt-2 pl-6 font-mono text-caption text-ink-3">请求号 {requestId}</p>
      ) : null}
    </div>
  );
}
