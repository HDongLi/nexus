import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn.ts";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  /** 字段下面的一句补充，出错时让位给错误。 */
  hint?: ReactNode;
  /** 行内常显的错误说明（实弹条款 2：失败要说清楚为什么、怎么办）。 */
  error?: ReactNode;
}

/** 单行输入框。标签在上，高 36 像素，和按钮同高，放在同一行时齐平。 */
export function TextInput({ label, hint, error, className, id, ...props }: TextInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error !== undefined && error !== null ? true : undefined}
        aria-describedby={(error ?? hint) ? noteId : undefined}
        className={cn(
          "h-9 w-full rounded-control border border-input bg-card px-3 text-foreground transition-colors outline-none placeholder:text-ink-4 hover:border-border-strong focus:border-primary/60 focus:ring-2 focus:ring-ring/40",
          error !== undefined && error !== null && "border-destructive/60",
          className,
        )}
        {...props}
      />
      {error !== undefined && error !== null ? (
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
