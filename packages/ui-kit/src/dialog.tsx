import { X } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./button.tsx";
import { cn } from "./cn.ts";

export interface DialogProps {
  title: ReactNode;
  /** 标题下面的一句说明。 */
  description?: ReactNode;
  children?: ReactNode;
  /** 底部一排动作，靠右。 */
  footer?: ReactNode;
  /** 要关掉了：按了 Esc、点了遮罩、点了右上角的叉，都会走到这里。 */
  onClose: () => void;
  /** 关掉之后焦点回到哪里。不给，就回到打开对话框之前有焦点的那个元素。 */
  returnFocusTo?: RefObject<HTMLElement | null>;
  className?: string;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * 对话框：浏览器自带的 <dialog> 加 showModal()，外面统一包一层外观。
 *
 * 用自带的对话框是因为它天生做对了几件自绘对话框容易漏的事：焦点圈在对话框里出不去、它后面的内容
 * 点不到、Esc 触发 cancel 事件、浮在最上层（窄屏的导航抽屉也盖不住它）。不用 alert、confirm：
 * 内嵌浏览器里原生对话框点不动（实弹条款 2）。
 *
 * 键盘：打开时焦点落在带 data-autofocus 的元素上，没有就落在第一个能输入的元素；Esc 关闭；关掉之后
 * 焦点回到打开它的按钮。
 */
export function Dialog({
  title,
  description,
  children,
  footer,
  onClose,
  returnFocusTo,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  // 按下时是不是按在遮罩上。在对话框里按下、拖到遮罩上松开，不算点遮罩。
  const pressedOnBackdrop = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const first =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      dialog.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      dialog.close();
      const target = returnFocusTo?.current ?? opener;
      if (target !== null && target !== undefined && target.isConnected) target.focus();
    };
  }, [returnFocusTo]);

  const onPointerDown = (event: PointerEvent<HTMLDialogElement>): void => {
    pressedOnBackdrop.current = event.target === event.currentTarget;
  };

  const onClick = (event: MouseEvent<HTMLDialogElement>): void => {
    const fromBackdrop = pressedOnBackdrop.current;
    pressedOnBackdrop.current = false;
    const card = cardRef.current;
    if (fromBackdrop && card !== null && !card.contains(event.target as Node)) onClose();
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      // 自己不进 Tab 的顺序：焦点只在里面的控件之间转，不落在对话框这一层上。
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={description !== undefined ? descriptionId : undefined}
      onCancel={(event) => {
        // 自己来关：关的时候还要把焦点还回去，交给浏览器关就没有这一步了。
        event.preventDefault();
        onClose();
      }}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={(event) => {
        // 不往外传：外壳听见 Esc 会把窄屏的导航抽屉一起收掉，这里只关对话框。
        if (event.key === "Escape") event.stopPropagation();
      }}
      className={cn(
        "m-auto max-h-dvh w-full max-w-md overflow-y-auto border-0 bg-transparent p-4 backdrop:bg-overlay",
        "animate-pop-in backdrop:animate-fade-in motion-reduce:animate-none motion-reduce:backdrop:animate-none",
        className,
      )}
    >
      <div
        ref={cardRef}
        className="rounded-panel bg-popover text-popover-foreground shadow-prominent"
      >
        <header className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-body font-semibold">
              {title}
            </h2>
            {description !== undefined ? (
              <p id={descriptionId} className="mt-1 text-ink-2">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="关闭"
            onClick={onClose}
            className="-mr-2"
          >
            <X />
          </Button>
        </header>
        {children !== undefined ? <div className="px-6 pt-5">{children}</div> : null}
        {footer !== undefined ? (
          <footer className="flex justify-end gap-2 px-6 pt-6 pb-6">{footer}</footer>
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}
