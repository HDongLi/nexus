import { Button, ConfirmButton, ItemAvatar, Notice, StatusBadge } from "@nexus/ui-kit";
import { ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { avatarLetter } from "../account-menu.tsx";
import { api, callApi } from "../../lib/api.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import { accountTitle, type Account } from "../../lib/people.ts";
import { useExpireSession } from "../../lib/session.ts";
import { formatLocalTime } from "../../lib/time.ts";
import { useDelayedFlag } from "../../lib/use-delayed-flag.ts";
import { EditAccountDialog } from "./edit-account-dialog.tsx";
import { ResetPasswordDialog } from "./reset-password-dialog.tsx";

export interface UserRowProps {
  account: Account;
  /** 建过工程的账号删不掉（规格 G-24）：收到那次 409 之后，这一行就不再画「删除」。 */
  deletable: boolean;
  /** 这一行的常显失败（护栏的几种 409）。 */
  failure: Explanation | undefined;
  onPatched: (account: Account) => void;
  onDeleted: (id: string) => void;
  onRowFailure: (id: string, text: Explanation | null) => void;
  onUndeletable: (id: string) => void;
}

/**
 * 人员清单的一行：头像字、显示名（管理员带盾标）、用户名和建号时间、状态标记、操作。
 * 操作从轻到重排：编辑、重置口令、停用/启用、删除。删除是两击确认；停用、启用是单击。
 */
export function UserRow({
  account,
  deletable,
  failure,
  onPatched,
  onDeleted,
  onRowFailure,
  onUndeletable,
}: UserRowProps) {
  const expire = useExpireSession();
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useDelayedFlag(pending);
  const inFlight = useRef(false);

  // 停用与启用是单击（规格 G-42 只把删除定成两击）。失败（最后一个管理员、不能动自己）
  // 常显在这一行下面，不是一闪而过的弹窗。
  const toggleDisabled = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    // 契约里停用、启用是两条路由，不是一条带参数的；按当下的状态挑一条。
    const disable = !account.isDisabled;
    const result = await callApi(() =>
      disable
        ? api.POST("/api/v1/users/{userId}/disable", {
            params: { path: { userId: account.id } },
          })
        : api.POST("/api/v1/users/{userId}/enable", {
            params: { path: { userId: account.id } },
          }),
    );
    inFlight.current = false;
    setPending(false);
    if (result.ok) {
      onRowFailure(account.id, null);
      onPatched(result.data.account);
      return;
    }
    if (result.failure.code === "auth_required") {
      expire();
      return;
    }
    onRowFailure(account.id, explainFailure(result.failure, result.details));
  };

  const remove = async (): Promise<void> => {
    const result = await callApi(() =>
      api.DELETE("/api/v1/users/{userId}", { params: { path: { userId: account.id } } }),
    );
    if (result.ok) {
      onRowFailure(account.id, null);
      onDeleted(account.id);
      return;
    }
    if (result.failure.code === "auth_required") {
      expire();
      return;
    }
    // 建过工程的不删（规格 G-24）：原因常显在这一行，这一行的「删除」从此换成「停用」的入口。
    if (result.failure.code === "identity_user_has_projects") onUndeletable(account.id);
    onRowFailure(account.id, explainFailure(result.failure, result.details));
  };

  return (
    <li className="rounded-control px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <ItemAvatar letter={avatarLetter(accountTitle(account))} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-ui font-medium text-foreground">
            <span className="truncate">{accountTitle(account)}</span>
            {account.isAdmin ? (
              <ShieldCheck aria-label="管理员" className="shrink-0 text-ink-3" />
            ) : null}
          </div>
          <div className="text-caption text-ink-3">
            <span className="font-mono">{account.username}</span>
            {" · "}
            <time dateTime={account.createdAt} title={account.createdAt}>
              {formatLocalTime(account.createdAt)}
            </time>
            {" 建号"}
          </div>
        </div>
        {account.isDisabled ? (
          <StatusBadge tone="warn" className="shrink-0">
            已停用
          </StatusBadge>
        ) : null}
        {/* 一行四个按钮放不下窄屏：窄屏整行折到名字下面（md 断点与侧栏抽屉一致），
            宽屏靠右站成一排。2026-11-29 截图实测：不加这条，430 像素下时间被挤得一字一行。 */}
        <div className="flex w-full items-center gap-1.5 md:ml-auto md:w-auto">
          <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
            编辑
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)}>
            重置口令
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void toggleDisabled()}
          >
            {busy ? "正在改…" : account.isDisabled ? "启用" : "停用"}
          </Button>
          {deletable ? (
            <ConfirmButton
              size="sm"
              className="text-destructive"
              onConfirm={() => void remove()}
              confirmLabel="再点一次确认"
            >
              删除
            </ConfirmButton>
          ) : null}
        </div>
      </div>
      {failure ? (
        <Notice tone="error" title={failure.title} requestId={failure.requestId} className="mt-2">
          {failure.detail}
        </Notice>
      ) : null}
      {editOpen ? (
        <EditAccountDialog
          account={account}
          onClose={() => setEditOpen(false)}
          onPatched={(next) => {
            setEditOpen(false);
            onRowFailure(account.id, null);
            onPatched(next);
          }}
          onSessionExpired={() => {
            setEditOpen(false);
            expire();
          }}
        />
      ) : null}
      {resetOpen ? (
        <ResetPasswordDialog
          account={account}
          onClose={() => setResetOpen(false)}
          onSessionExpired={() => {
            setResetOpen(false);
            expire();
          }}
        />
      ) : null}
    </li>
  );
}
