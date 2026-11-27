import { X } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button.tsx";
import { Notice, type NoticeProps } from "./notice.tsx";

/** 一条浮在页面角落的提示。做成了什么、接下来会怎样，用它说，不用弹窗。 */
export interface ToastItem {
  id: number;
  tone: NoticeProps["tone"];
  title: string;
  detail?: ReactNode;
  requestId?: string | undefined;
}

/**
 * 提示的落处：窗口右下角，新来的排在下面。提示不会自己消失，要看的人点掉为止——
 * 「改完口令别处的登录会失效」这种话，一闪而过等于没说。
 */
export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div
      aria-label="提示"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto relative min-w-64 max-w-sm overflow-hidden rounded-card bg-popover shadow-prominent"
        >
          {/* 提示条自己的淡色底是半透明的，垫在浮面的底色上；这里只补上关闭按钮让出的位置。 */}
          <Notice
            tone={toast.tone}
            title={toast.title}
            requestId={toast.requestId}
            className="pr-11"
          >
            {toast.detail}
          </Notice>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="关闭提示"
            className="absolute top-2 right-2"
            onClick={() => onDismiss(toast.id)}
          >
            <X />
          </Button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
