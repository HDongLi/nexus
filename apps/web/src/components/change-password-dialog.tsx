import { Button, Dialog, Notice, PasswordInput, type DialogProps } from "@nexus/ui-kit";
import { useRef, useState, type FormEvent } from "react";
import { api, callApi } from "../lib/api.ts";
import { withoutErrorIfFilled, type FieldErrors } from "../lib/field-errors.ts";
import { explainFailure, type Explanation } from "../lib/failure.ts";

type Field = "current" | "next" | "confirm";

type FormErrors = FieldErrors<Field>;

/** 哪些失败是哪一个字段的事：挨着那个字段说，比对着一整张表说有用。 */
const FIELD_OF: Record<string, Field> = {
  auth_current_password_wrong: "current",
  auth_password_too_weak: "next",
  auth_password_reused: "next",
};

/** 登录没了的话别留着对话框：交还给外壳，它会把人送回登录页。 */
export interface ChangePasswordDialogProps extends Omit<
  DialogProps,
  "title" | "footer" | "children"
> {
  onChanged: () => void;
  onSessionExpired: () => void;
}

/** 本人改密：旧口令、新口令、重复新口令。只查服务器查不了的（空着、两次不一样），其余交给接口。 */
export function ChangePasswordDialog({
  onChanged,
  onSessionExpired,
  ...dialog
}: ChangePasswordDialogProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Explanation | null>(null);
  const [pending, setPending] = useState(false);
  // 提交在途的标记：按钮已经点了不能点，这里当场拒绝第二次，不等界面重画。
  const inFlight = useRef(false);
  const inputs = {
    current: useRef<HTMLInputElement>(null),
    next: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  /** 这个字段重新有内容了，撤掉它那句「请输入」。 */
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
      current: current === "" ? "请输入现在的口令" : undefined,
      next: next === "" ? "请输入新口令" : undefined,
      confirm: confirm === "" ? "请再输一次新口令" : undefined,
    };
    if (confirm !== "" && next !== "" && confirm !== next) local.confirm = "两次输入的新口令不一样";
    if (Object.values(local).some((message) => message !== undefined)) {
      fail(local);
      return;
    }
    // 这次填全了，上一次留在字段下面的那句话不再成立。
    setErrors({});
    inFlight.current = true;
    setPending(true);
    const result = await callApi(() =>
      api.POST("/api/v1/auth/password", {
        body: { currentPassword: current, newPassword: next },
      }),
    );
    inFlight.current = false;
    setPending(false);
    if (result.ok) {
      onChanged();
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
    } else fail({ [field]: text.title });
  };

  return (
    <Dialog
      {...dialog}
      title="修改口令"
      description="改完后，别的设备上要用新口令重新登录。"
      footer={
        <>
          <Button variant="secondary" onClick={dialog.onClose}>
            取消
          </Button>
          <Button type="submit" form="change-password" disabled={pending} aria-busy={pending}>
            保存
          </Button>
        </>
      }
    >
      <form
        id="change-password"
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
          ref={inputs.current}
          data-autofocus
          label="旧口令"
          autoComplete="current-password"
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
            retract("current", event.target.value);
          }}
          error={errors.current}
        />
        <PasswordInput
          ref={inputs.next}
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
    </Dialog>
  );
}
