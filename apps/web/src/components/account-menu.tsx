import { Menu, MenuItem, buttonClass, type ToastItem } from "@nexus/ui-kit";
import { useRef, useState } from "react";
import { ChevronDown, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { ChangePasswordDialog } from "./change-password-dialog.tsx";
import { useExpireSession, useSignOut, type CurrentUser } from "../lib/session.ts";

/** 是不是汉字（中日韩统一表意文字那一段，0x3400 到 0x9fff）。 */
function isIdeograph(letter: string): boolean {
  const code = letter.codePointAt(0);
  return code !== undefined && code >= 0x3400 && code <= 0x9fff;
}

/** 头像里的那一个字：西文名取首字母；中文名取最后一个字，中文里习惯这么称呼一个人。 */
export function avatarLetter(name: string): string {
  const letters = Array.from(name.trim());
  const first = letters[0];
  if (first === undefined) return "?";
  const last = letters.at(-1);
  return letters.length > 1 && last !== undefined && isIdeograph(last) ? last : first.toUpperCase();
}

/** 侧栏底部的当前用户：点开是「改密」「退出登录」。 */
export function AccountMenu({
  user,
  onNotice,
}: {
  user: CurrentUser;
  onNotice: (toast: Omit<ToastItem, "id">) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const signOut = useSignOut();
  const expire = useExpireSession();
  const name = user.displayName.trim() === "" ? user.username : user.displayName;
  const hasHandle = name !== user.username;

  const leave = async (): Promise<void> => {
    const left = await signOut();
    // 没退成多半是后端连不上：会话还在，人还登录着，留在原地把原因说出来。
    if (!left)
      onNotice({
        tone: "error",
        title: "没有退出",
        detail: "连不上服务器，稍后再试。",
      });
  };

  return (
    <>
      <Menu
        label="账号菜单"
        trigger={(props) => (
          <button
            {...props}
            className={buttonClass(
              { variant: "ghost" },
              "h-auto w-full justify-start gap-2.5 px-2 py-2 text-left",
            )}
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 select-none items-center justify-center rounded-full bg-fill-strong text-ui font-semibold text-foreground"
            >
              {avatarLetter(name)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                <span className="truncate font-medium">{name}</span>
                {user.isAdmin ? (
                  <ShieldCheck aria-label="管理员" className="shrink-0 text-ink-3" />
                ) : null}
              </span>
              {hasHandle ? (
                <span className="truncate text-caption text-ink-3">{user.username}</span>
              ) : null}
            </span>
            <ChevronDown aria-hidden="true" className="shrink-0 text-ink-3" />
          </button>
        )}
      >
        {/* 不写菜单抬头：按钮上已经是这个人和他的标记，抬头只会把同样的话再说一遍。 */}
        <MenuItem icon={<KeyRound />} onSelect={() => setPasswordOpen(true)}>
          修改口令
        </MenuItem>
        <MenuItem icon={<LogOut />} onSelect={() => void leave()}>
          退出登录
        </MenuItem>
      </Menu>
      {passwordOpen ? (
        <ChangePasswordDialog
          returnFocusTo={buttonRef}
          onClose={() => setPasswordOpen(false)}
          onChanged={() => {
            setPasswordOpen(false);
            onNotice({
              tone: "success",
              title: "口令已更新",
              detail: "其它设备上的登录已失效。",
            });
          }}
          onSessionExpired={() => {
            setPasswordOpen(false);
            expire();
          }}
        />
      ) : null}
    </>
  );
}
