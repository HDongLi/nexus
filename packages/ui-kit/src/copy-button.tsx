import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "./button.tsx";

export interface CopyButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  /** 要放进剪贴板的内容。 */
  value: string;
  /** 平时按钮上的字。 */
  label?: string;
  /** 复制成功后短暂显示的字。 */
  copiedLabel?: string;
}

/**
 * 复制钮：把一段要人拿走的内容放进剪贴板，成功后短促地说一声「已复制」，两秒后复原。
 * 剪贴板被拒（权限没给、窗口没焦点）时不弹任何提示：调用方应把内容摆在旁边让人手动选，
 * 这里静默失败就好（实弹条款 2：反馈用页面自己的话，不用浏览器原生的）。
 */
export function CopyButton({
  value,
  label = "复制",
  copiedLabel = "已复制",
  variant = "secondary",
  ...rest
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button {...rest} type="button" variant={variant} onClick={() => void copy()}>
      {copied ? <Check /> : <Copy />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
