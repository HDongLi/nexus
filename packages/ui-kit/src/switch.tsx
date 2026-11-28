import { useId, type MouseEvent } from "react";
import { cn } from "./cn.ts";

export interface SwitchProps {
  /** 整行的标签，也是开关给读屏软件的名字。 */
  label: string;
  /** 标签下面的一句说明。 */
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

/**
 * 开关：一行「标签加轨道」。真正的开关是里面的按钮（role="switch"），键盘 Tab 到它、空格切换；
 * 整行也能点。点行时先看这一下是不是落在按钮上——是就不重复切：按钮自己的 click 会冒泡上来，
 * 两个都算就把开关拨回去又拨回来（2026-11-29，照外壳抽屉「点导航里的链接才收起」的同款判法）。
 * 几何：轨道 h-5 w-9，滑块 size-4，左右各留 2 像素；滑开的距离是内宽减滑块（14 像素，translate-x-3.5）。
 */
export function Switch({ label, hint, checked, onCheckedChange, disabled, id }: SwitchProps) {
  const autoId = useId();
  const labelId = id ?? autoId;
  const rowClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (disabled) return;
    if ((event.target as HTMLElement).closest("button")) return;
    onCheckedChange(!checked);
  };
  return (
    <div
      className={cn("flex items-center justify-between gap-3", !disabled && "cursor-pointer")}
      onClick={rowClick}
    >
      <span id={labelId} className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint !== undefined ? (
          <span className="mt-0.5 block text-caption text-ink-2">{hint}</span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        className={cn(
          "flex h-5 w-9 shrink-0 items-center rounded-full border px-0.5 outline-none transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-45",
          checked ? "border-primary bg-primary" : "border-border-strong bg-fill-strong",
        )}
        onClick={() => onCheckedChange(!checked)}
      >
        <span
          aria-hidden="true"
          className={cn(
            "block size-4 rounded-full bg-card transition-transform duration-150",
            checked ? "translate-x-3.5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}
