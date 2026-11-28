import { Button, Dialog, Notice, TextInput, type DialogProps } from "@nexus/ui-kit";
import { useRef, useState, type FormEvent } from "react";
import { api, callApi } from "../../lib/api.ts";
import { withoutErrorIfFilled, type FieldErrors } from "../../lib/field-errors.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import type { Group } from "../../lib/people.ts";
import { useDelayedFlag } from "../../lib/use-delayed-flag.ts";

type Field = "name";

type FormErrors = FieldErrors<Field>;

const FIELD_OF: Record<string, Field> = {
  identity_group_name_taken: "name",
};

export interface CreateGroupDialogProps extends Omit<DialogProps, "title" | "footer"> {
  /** 建成了：把接口回的那条交给清单页。成员和可见的工程建好后进详情页再加（规格 G-26）。 */
  onCreated: (group: Group) => void;
  onSessionExpired: () => void;
}

/**
 * 新建用户组：只有一个名字。组名全平台唯一、不分大小写（规格 G-25）；
 * 撞了的名字挨着输入框常显（规格 G-41）。
 */
export function CreateGroupDialog({
  onCreated,
  onSessionExpired,
  ...dialog
}: CreateGroupDialogProps) {
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Explanation | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useDelayedFlag(pending);
  const inFlight = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const retract = (field: Field, value: string): void =>
    setErrors((current) => withoutErrorIfFilled(current, field, value));

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (inFlight.current) return;
    if (name.trim() === "") {
      setErrors({ name: "请输入组名" });
      setFailure(null);
      nameRef.current?.focus();
      return;
    }
    setErrors({});
    inFlight.current = true;
    setPending(true);
    const result = await callApi(() => api.POST("/api/v1/groups", { body: { name } }));
    inFlight.current = false;
    setPending(false);
    if (result.ok) {
      onCreated(result.data.group);
      return;
    }
    if (result.failure.code === "auth_required") {
      onSessionExpired();
      return;
    }
    const text = explainFailure(result.failure, result.details);
    if (FIELD_OF[result.failure.code] === undefined) {
      setErrors({});
      setFailure(text);
      return;
    }
    setErrors({ name: text.title });
    setFailure(null);
    nameRef.current?.focus();
  };

  return (
    <Dialog
      {...dialog}
      title="新建用户组"
      description="组是给工程划可见范围用的：把同事拉进组，再把工程给组看。"
      footer={
        <>
          <Button variant="secondary" onClick={dialog.onClose}>
            取消
          </Button>
          <Button type="submit" form="create-group" disabled={pending} aria-busy={pending}>
            {busy ? "正在创建…" : "创建"}
          </Button>
        </>
      }
    >
      <form
        id="create-group"
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
          ref={nameRef}
          data-autofocus
          label="组名"
          name="name"
          hint="1 到 64 个字，全平台唯一，不分大小写。"
          autoComplete="off"
          spellCheck={false}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            retract("name", event.target.value);
          }}
          error={errors.name}
        />
      </form>
    </Dialog>
  );
}
