import { Button, Dialog, Notice, Switch, TextInput, type DialogProps } from "@nexus/ui-kit";
import { useRef, useState, type FormEvent } from "react";
import { api, callApi } from "../../lib/api.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import type { Account } from "../../lib/people.ts";

export interface EditAccountDialogProps extends Omit<DialogProps, "title" | "footer" | "children"> {
  account: Account;
  /** 改成了：把接口回的那条交给清单页，那一行跟着变。 */
  onPatched: (account: Account) => void;
  onSessionExpired: () => void;
}

/**
 * 改显示名和管理员位。两个字段都发（值没变时服务器什么也不写、不发事件，规格 G-13），
 * 所以管理员位的护栏 409（最后一个管理员、不能动自己）也只在这一步被服务器说出。
 * 用户名不在这一页改（身份规格没有这条路由），建好就不能改。
 */
export function EditAccountDialog({
  account,
  onPatched,
  onSessionExpired,
  ...dialog
}: EditAccountDialogProps) {
  const [displayName, setDisplayName] = useState(account.displayName);
  const [isAdmin, setIsAdmin] = useState(account.isAdmin);
  const [failure, setFailure] = useState<Explanation | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const result = await callApi(() =>
      api.PATCH("/api/v1/users/{userId}", {
        params: { path: { userId: account.id } },
        body: { displayName, isAdmin },
      }),
    );
    inFlight.current = false;
    setPending(false);
    if (result.ok) {
      onPatched(result.data.account);
      return;
    }
    if (result.failure.code === "auth_required") {
      onSessionExpired();
      return;
    }
    setFailure(explainFailure(result.failure, result.details));
  };

  return (
    <Dialog
      {...dialog}
      title="改账号"
      description={`用户名 ${account.username} 建好后不能改；能改的是显示名和管理员位。`}
      footer={
        <>
          <Button variant="secondary" onClick={dialog.onClose}>
            取消
          </Button>
          <Button type="submit" form="edit-account" disabled={pending} aria-busy={pending}>
            保存
          </Button>
        </>
      }
    >
      <form
        id="edit-account"
        className="space-y-4"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        {failure ? (
          <Notice tone="error" title={failure.title} requestId={failure.requestId}>
            {failure.detail}
          </Notice>
        ) : null}
        <TextInput
          data-autofocus
          label="显示名"
          name="displayName"
          hint="最长 64。清空保存就是清除，页面上会显示用户名。"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <Switch
          label="管理员"
          hint="系统至少要留一个启用的管理员：降掉最后一个会被拒绝。"
          checked={isAdmin}
          onCheckedChange={setIsAdmin}
        />
      </form>
    </Dialog>
  );
}
