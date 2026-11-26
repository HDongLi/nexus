import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 拼类名： clsx 负责条件，tailwind-merge 负责去掉互相冲突的后者。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
