import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** 标题一行。给了才画标题栏；不给就是一张干净的卡。 */
  title?: ReactNode;
  /** 标题前面的图标，16 像素的线性图标。 */
  icon?: ReactNode;
  /** 标题栏右边的动作。 */
  actions?: ReactNode;
  children?: ReactNode;
  bodyClassName?: string;
}

/**
 * 面板：页面上装内容的基本单位。「浮起」靠的是一圈半像素的细描边加两层极淡的柔影，
 * 所以页面底色保持纯色就够了，不需要再给面板垫一层灰。
 */
export function Panel({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  ...rest
}: PanelProps) {
  return (
    <section
      {...rest}
      className={cn("rounded-card bg-card text-card-foreground shadow-soft", className)}
    >
      {title !== undefined ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
          <h2 className="flex min-w-0 items-center gap-2 font-medium">
            {icon !== undefined ? (
              <span className="flex shrink-0 items-center text-ink-3 [&_svg]:size-4">{icon}</span>
            ) : null}
            <span className="truncate">{title}</span>
          </h2>
          {actions !== undefined ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </header>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
