import type { HTMLAttributes } from "react";
import { cn } from "./cn.ts";

/**
 * 行内的代码或标识符：编号、版本号、请求号、字段名。
 * 一小块淡底、小圆角、等宽字体。等宽是为了编号对齐时数位不跳。
 */
export function InlineCode({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        "rounded-md bg-fill px-1.5 py-0.5 font-mono text-ui leading-5 whitespace-nowrap text-foreground",
        className,
      )}
      {...props}
    />
  );
}
