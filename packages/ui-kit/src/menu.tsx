import { Check } from "lucide-react";
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn.ts";

/** 菜单离窗口边至少留这么多；和触发它的按钮之间隔这么多。 */
const MARGIN = 8;
const GAP = 4;

/** 触发按钮要接的属性：点开、键盘、给读屏软件的状态都在这里，铺到自己的 <button> 上。 */
export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  type: "button";
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
}

export interface MenuProps {
  /** 给读屏软件的名字。 */
  label: string;
  trigger: (props: MenuTriggerProps) => ReactNode;
  /** 菜单的哪一边和按钮对齐。默认左对齐。 */
  align?: "start" | "end";
  children: ReactNode;
}

interface Position {
  left: number;
  top: number;
  minWidth: number;
}

interface MenuApi {
  /** 收起菜单。restoreFocus 为真时把焦点还给触发它的按钮。 */
  close: (restoreFocus: boolean) => void;
}

const MenuContext = createContext<MenuApi | null>(null);

function useMenu(): MenuApi {
  const api = useContext(MenuContext);
  if (api === null) throw new Error("菜单项要放在 Menu 里面");
  return api;
}

// 焦点一定看得见：用键盘时是焦点环（菜单项多是程序把焦点移过去的，focus-visible 认得出键盘），用鼠标时是底色。
const ITEM_CLASS =
  "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 outline-none transition-colors duration-150 hover:bg-fill focus:bg-fill focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * 弹出菜单：一个按钮，点开一张浮在页面之上的单子。用户菜单、主题切换都用它。
 *
 * 照「菜单按钮」的通行做法做键盘（WAI-ARIA 的 menu button pattern）：按钮上按回车、空格或方向键打开，
 * 焦点进第一项；上下方向键在各项之间走；Esc 收起并把焦点还给按钮；Tab 直接走出去，菜单跟着收起。
 *
 * 菜单画在 <body> 下面，不画在按钮旁边：窄屏时侧栏整条带着位移变换，放进它里面的 fixed 定位会以侧栏
 * 为准，而不是以窗口为准（写在这里防回退）。
 */
export function Menu({ label, trigger, align = "start", children }: MenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  // 方向键打开时落在哪一项：向下落第一项，向上落最后一项。
  const focusLast = useRef(false);

  const dismiss = (): void => {
    setOpen(false);
    setPosition(null);
  };
  const close = (restoreFocus: boolean): void => {
    dismiss();
    if (restoreFocus) triggerRef.current?.focus();
  };

  const items = (): HTMLElement[] =>
    menuRef.current === null
      ? []
      : Array.from(menuRef.current.querySelectorAll<HTMLElement>("[role^='menuitem']"));

  useLayoutEffect(() => {
    if (!open) return;
    const button = triggerRef.current;
    const menu = menuRef.current;
    if (button === null || menu === null) return;

    const b = button.getBoundingClientRect();
    // 量版面大小用 offsetWidth：菜单正在做入场的缩放动画，getBoundingClientRect 量到的是缩小后的。
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let top = b.bottom + GAP;
    // 下面放不下就翻到上面去。侧栏底部的账号菜单永远是这种情况。
    if (top + height > window.innerHeight - MARGIN) top = Math.max(MARGIN, b.top - GAP - height);
    let left = align === "end" ? b.right - width : b.left;
    left = Math.min(Math.max(MARGIN, left), window.innerWidth - width - MARGIN);
    setPosition({ left, top, minWidth: b.width });
    const list = items();
    (focusLast.current ? list.at(-1) : list[0])?.focus();
    focusLast.current = false;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      // 点在按钮上不算点到外面：随后的 click 会把菜单收起，这里不抢先。
      if (target instanceof Node && (menu.contains(target) || button.contains(target))) return;
      dismiss();
    };
    const onResize = (): void => dismiss();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open, align]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    focusLast.current = event.key === "ArrowUp";
    setOpen(true);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = document.activeElement;
    const list = items();
    const index = current instanceof HTMLElement ? list.indexOf(current) : -1;
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step !== 0 && index >= 0) {
      event.preventDefault();
      list[(index + step + list.length) % list.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? list[0] : list.at(-1))?.focus();
    } else if (event.key === "Escape") {
      // 不往外传：外壳听见 Esc 会把窄屏的导航抽屉一起收掉，这里只收菜单。
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  // Tab 不拦：让浏览器把焦点移到下一处，焦点一走出菜单，下面的 onBlur 就把菜单收起。

  // 焦点走出菜单和按钮（Tab 走开，或者点到了页面别处），菜单收起。
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (
      next instanceof Node &&
      (event.currentTarget.contains(next) || triggerRef.current?.contains(next))
    )
      return;
    dismiss();
  };

  return (
    <>
      {trigger({
        ref: triggerRef,
        type: "button",
        onClick: () => setOpen((shown) => !shown),
        onKeyDown: onTriggerKeyDown,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
      })}
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKeyDown}
              onBlur={onBlur}
              // 量好位置之前不画出来：刚挂上时它还在左上角。
              className={cn(
                "fixed z-50 rounded-panel border border-border bg-popover p-1 text-popover-foreground shadow-prominent",
                "animate-pop-in motion-reduce:animate-none",
                position === null && "opacity-0",
              )}
              style={{ left: position?.left, top: position?.top, minWidth: position?.minWidth }}
            >
              <MenuContext.Provider value={{ close }}>{children}</MenuContext.Provider>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export interface MenuItemProps {
  icon?: ReactNode;
  /** 选中了这一项：菜单先收起、把焦点还给按钮，再调用它。 */
  onSelect?: () => void;
  children: ReactNode;
}

export function MenuItem({ icon, onSelect, children }: MenuItemProps) {
  const menu = useMenu();
  return (
    <button
      type="button"
      role="menuitem"
      className={ITEM_CLASS}
      onClick={() => {
        menu.close(true);
        onSelect?.();
      }}
    >
      {icon ?? <span aria-hidden="true" className="size-4 shrink-0" />}
      <span className="flex-1 truncate text-left">{children}</span>
    </button>
  );
}

/** 单选的一项：同一组里只有一项是选中的，选中的那项右边打一个勾。 */
export function MenuRadioItem({
  icon,
  checked,
  onSelect,
  children,
}: MenuItemProps & { checked: boolean }) {
  const menu = useMenu();
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className={ITEM_CLASS}
      onClick={() => {
        menu.close(true);
        onSelect?.();
      }}
    >
      {icon ?? <span aria-hidden="true" className="size-4 shrink-0" />}
      <span className="flex-1 truncate text-left">{children}</span>
      <Check aria-hidden="true" className={checked ? undefined : "invisible"} />
    </button>
  );
}
