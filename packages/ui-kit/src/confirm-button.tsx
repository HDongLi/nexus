import { useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "./button.tsx";
import { cn } from "./cn.ts";

export interface ConfirmButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  /** 要做的动作。第一下只进入确认态，第二下才走到这里。 */
  onConfirm: () => void;
  /** 确认态按钮上的字。 */
  confirmLabel?: string;
  /** 确认态里的一句后果（悬停可见、读屏软件会念）：危险动作要说清第二下会怎样。 */
  confirmTitle?: string;
  /** 多少毫秒没有第二下就自己复原。 */
  resetMs?: number;
  /** 平时（未进入确认态）按钮上的字。 */
  children: ButtonProps["children"];
}

/**
 * 两击确认钮（规格 G-42）：第一下变成「再点一次确认」，3 秒内没有第二下就自己复原。
 * 危险动作（删号、删组）走它，不用浏览器原生的 confirm——内嵌浏览器里原生对话框点不动
 * （实弹条款 2），而且原生框里那句话点完就没了，不符合「失败与后果要常显」的要求。
 * 确认态换成 destructive 变体：颜色说「下一步是危险的那一下」。
 */
export function ConfirmButton({
  onConfirm,
  confirmLabel = "再点一次确认",
  confirmTitle,
  resetMs = 3000,
  variant = "ghost",
  className,
  disabled,
  children,
  ...rest
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // 卸载时把定时器收掉，免得它回头改一个已经不存在的组件的状态。
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  const click = (): void => {
    if (armed) {
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setArmed(false);
    }, resetMs);
  };

  return (
    <Button
      {...rest}
      type="button"
      disabled={disabled}
      variant={armed ? "destructive" : variant}
      className={cn(className)}
      onClick={click}
      aria-pressed={armed}
      title={armed ? confirmTitle : undefined}
      aria-label={
        armed
          ? confirmTitle !== undefined
            ? `${confirmLabel}。${confirmTitle}`
            : undefined
          : undefined
      }
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
