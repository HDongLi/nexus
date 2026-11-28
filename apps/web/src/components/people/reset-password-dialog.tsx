import {
  Button,
  CopyButton,
  Dialog,
  Notice,
  PasswordInput,
  TextInput,
  type DialogProps,
} from "@nexus/ui-kit";
import { useRef, useState, type FormEvent } from "react";
import { api, callApi } from "../../lib/api.ts";
import { withoutErrorIfFilled, type FieldErrors } from "../../lib/field-errors.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import type { Account } from "../../lib/people.ts";

type Field = "next" | "confirm";

type FormErrors = FieldErrors<Field>;

const FIELD_OF: Record<string, Field> = {
  auth_password_too_weak: "next",
};

export interface ResetPasswordDialogProps extends Omit<
  DialogProps,
  "title" | "footer" | "children"
> {
  account: Account;
  onSessionExpired: () => void;
}

/**
 * 管理员重置口令：新口令输两遍；成功后把新口令只显示这一次，带一个「复制」钮，
 * 关掉就看不到了（规格的任务书明说了这条）。重置会吊销这个账号的全部会话——
 * 对话框里把这句话说在前头；操作者自己的会话由后端保证不动，不能给自己重置（G-19）。
 */
export function ResetPasswordDialog({
  account,
  onSessionExpired,
  ...dialog
}: ResetPasswordDialogProps) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Explanation | null>(null);
  const [pending, setPending] = useState(false);
  // 成功后存新口令：对话框换一种状态，只显示这一次，关掉就没了。
  const [revealed, setRevealed] = useState<string | null>(null);
  const inFlight = useRef(false);
  const inputs = {
    next: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  const retract = (field: Field, value: string): void =>
    setErrors((current) => withoutErrorIfFilled(current, field, value));

  const fail = (nextErrors: FormErrors): void => {
    setErrors(nextErrors);
    setFailure(null);
    const first = (Object.keys(inputs) as Field[]).find((field) => nextErrors[field] !== undefined);
    if (first !== undefined) inputs[first].current?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (inFlight.current) return;
    const local: FormErrors = {
      next: next === "" ? "请输入新口令" : undefined,
      confirm: confirm === "" ? "请再输一次新口令" : undefined,
    };
    if (confirm !== "" && next !== "" && confirm !== next) local.confirm = "两次输入的新口令不一样";
    if (local.next !== undefined || local.confirm !== undefined) {
      fail(local);
      return;
    }
    setErrors({});
    inFlight.current = true;
    setPending(true);
    const result = await callApi(() =>
      api.POST("/api/v1/users/{userId}/password", {
        params: { path: { userId: account.id } },
        body: { newPassword: next },
      }),
    );
    inFlight.current = false;
    setPending(false);
    if (result.ok) {
      setRevealed(next);
      return;
    }
    if (result.failure.code === "auth_required") {
      onSessionExpired();
      return;
    }
    const text = explainFailure(result.failure, result.details);
    const field = FIELD_OF[result.failure.code];
    if (field === undefined) {
      setErrors({});
      setFailure(text);
      return;
    }
    fail({ [field]: text.title });
  };

  return (
    <Dialog
      {...dialog}
      title={revealed !== null ? "口令已重置" : "重置口令"}
      description={
        revealed !== null
          ? `${account.username} 的会话已全部失效，要用新口令重新登录。`
          : `给 ${account.username} 换一个新口令。重置后这个人的会话立即全部失效，他要用新口令重新登录。`
      }
      footer={
        revealed !== null ? (
          <Button onClick={dialog.onClose}>完成</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={dialog.onClose}>
              取消
            </Button>
            <Button type="submit" form="reset-password" disabled={pending} aria-busy={pending}>
              重置
            </Button>
          </>
        )
      }
    >
      {revealed !== null ? (
        <div className="space-y-4">
          <Notice tone="success" title="口令已重置">
            新口令只在下面这一处显示，关掉这个对话框就看不到了。
          </Notice>
          <div className="flex items-end gap-2">
            <TextInput
              readOnly
              label="新口令（只显示这一次）"
              className="font-mono select-all"
              value={revealed}
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton value={revealed} className="mb-0.5" />
          </div>
          <p className="text-caption text-ink-2">复制下来交给本人。关掉就看不到了。</p>
        </div>
      ) : (
        <form
          id="reset-password"
          className="space-y-4"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          {failure ? (
            <Notice tone="error" title={failure.title} requestId={failure.requestId}>
              {failure.detail}
            </Notice>
          ) : null}
          <PasswordInput
            ref={inputs.next}
            data-autofocus
            label="新口令"
            autoComplete="new-password"
            value={next}
            onChange={(event) => {
              setNext(event.target.value);
              retract("next", event.target.value);
            }}
            error={errors.next}
          />
          <PasswordInput
            ref={inputs.confirm}
            label="重复新口令"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value);
              retract("confirm", event.target.value);
            }}
            error={errors.confirm}
          />
        </form>
      )}
    </Dialog>
  );
}
