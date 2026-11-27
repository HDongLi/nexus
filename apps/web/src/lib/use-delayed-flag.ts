import { useEffect, useState } from "react";

/**
 * 要显示「正在……」时用：状态持续超过一小会儿才亮起来，很快就结束的不亮。
 * 本机的接口几十毫秒就回来了，按钮上的字一闪即变，比不变更难看。
 */
export function useDelayedFlag(value: boolean, delayMs = 200): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!value) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return shown;
}
