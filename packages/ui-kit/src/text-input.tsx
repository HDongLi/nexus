import { useId, type InputHTMLAttributes, type ReactNode, type RefAttributes } from "react";
import { cn } from "./cn.ts";

export interface TextInputProps
  extends InputHTMLAttributes<HTMLInputElement>, RefAttributes<HTMLInputElement> {
  label: ReactNode;
  /** 字段下面的一句补充，出错时让位给错误。 */
  hint?: ReactNode;
  /** 行内常显的错误说明（实弹条款 2：失败要说清楚为什么、怎么办）。 */
  error?: ReactNode;
  /** 输入框右端的一个小动作（比如口令的「显示」按钮）。给了它，文字给按钮让出位置。 */
  trailing?: ReactNode;
}

/** 单行输入框。标签在上，高 36 像素，和按钮同高，放在同一行时齐平。 */
export function TextInput({
  label,
  hint,
  error,
  trailing,
  className,
  id,
  "aria-describedby": describedBy,
  ...props
}: TextInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const failed = error !== undefined && error !== null;
  // 调用方自己指的说明和这里的错误、补充并在一起，读屏软件两样都念。
  const description = [describedBy, (error ?? hint) ? noteId : undefined].filter(Boolean).join(" ");
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={failed ? true : undefined}
          aria-describedby={description || undefined}
          className={cn(
            "h-9 w-full rounded-control border bg-card px-3 text-foreground transition-colors outline-none placeholder:text-ink-4",
            // 两套互斥的状态，各管各的：平时淡边，指上去深一点，对准了是蓝色的边和环；
            // 出错了是红边和红环，对准了也不让位（2026-11-27 截图里看到：两套写在一起时，
            // 对准了的出错字段，红边会被盖成蓝的）。
            !failed &&
              "border-input hover:border-border-strong focus:border-primary/60 focus:ring-2 focus:ring-ring/40",
            failed && "border-destructive/60 focus:ring-2 focus:ring-destructive/30",
            trailing !== undefined && "pr-10",
            className,
          )}
          {...props}
        />
        {/* 右端的小动作浮在输入框里面；整列撑满高度，点按钮旁边的一点空隙也算点它。 */}
        {trailing !== undefined ? (
          <div className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</div>
        ) : null}
      </div>
      {failed ? (
        <p id={noteId} role="alert" className="text-destructive">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={noteId} className="text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
