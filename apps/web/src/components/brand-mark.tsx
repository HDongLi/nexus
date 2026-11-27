import { cn } from "@nexus/ui-kit";

/** 标志：一个环加一个心点，「枢纽」的意思。只用强调色，不用渐变。 */
export function BrandMark({
  className,
  strokeWidth = 1.75,
}: {
  className?: string;
  /** 画得比导航里那个大的时候线要跟着粗一点，不然显得单薄。 */
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={cn("size-5 shrink-0 text-primary", className)}
      fill="none"
    >
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth={strokeWidth} />
      <circle cx="10" cy="10" r="2.5" fill="currentColor" />
    </svg>
  );
}
