const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * 给人看的时间：本地时区的「年-月-日 时:分:秒」，和日志里的写法一致，方便对照。
 * 自己拼，不用 toLocaleString：2026-11-26 实测，它带上毫秒选项时在 Chromium 里回的是
 * 错误结果（「413」而不是完整时间），不同内核的表现也不保证一样。
 */
export function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
