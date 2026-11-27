import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.ts";

/**
 * 按钮。六个变体沿用的是 shadcn 的名字，它的命令行工具生成的组件拿来就能用。
 * 视觉规则（决策记录 0004）：只有主按钮有颜色，其余全是平的；不用阴影，靠一像素的边和悬停底色区分。
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-ui font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "border border-border-strong bg-card text-card-foreground hover:bg-fill",
        outline: "border border-border-strong bg-transparent text-foreground hover:bg-fill",
        ghost: "text-foreground hover:bg-fill hover:text-foreground",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 gap-1.5 px-3",
        lg: "h-10 px-5 text-body",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

/** 只要按钮的类名、自己写元素的时候用（比如把类名铺到一个带路由的链接上）。 */
export function buttonClass(
  options?: VariantProps<typeof buttonVariants>,
  className?: string,
): string {
  return cn(buttonVariants(options), className);
}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
