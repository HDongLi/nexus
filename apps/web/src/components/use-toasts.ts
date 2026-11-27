import type { ToastItem } from "@nexus/ui-kit";
import { useCallback, useState } from "react";

let nextId = 1;

/** 右下角的常显提示：做成了什么、接下来会怎样。外壳持有它，页面各处的动作都往这里放。 */
export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((toast: Omit<ToastItem, "id">): void => {
    setItems((list) => [...list, { ...toast, id: nextId++ }]);
  }, []);
  const dismiss = useCallback(
    (id: number): void => setItems((list) => list.filter((toast) => toast.id !== id)),
    [],
  );
  return { items, show, dismiss };
}
