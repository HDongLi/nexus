import { Button, Dialog, Notice, TextInput, type DialogProps } from "@nexus/ui-kit";
import { useRef, useState, type FormEvent } from "react";
import { api, callApi } from "../../lib/api.ts";
import { withoutErrorIfFilled, type FieldErrors } from "../../lib/field-errors.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import type { Group } from "../../lib/people.ts";

type Field = "name";

type FormErrors = FieldErrors<Field>;

const FIELD_OF: Record<string, Field> = {
  identity_group_name_taken: "name",
};

export interface RenameGroupDialogProps extends Omit<DialogProps, "title" | "footer" | "children"> {
  group: Group;
  /** 改成了：把接口回的那条交给页面，详情标题和清单跟着变。成员与可见工程不动（规格 G-29）。 */
  onRenamed: (group: Group) => void;
  onSessionExpired: () => void;
}

/** 改组名。撞了的名字挨着输入框常显（规格 G-41）；名字没变时服务器什么都不写（规格 G-29）。 */
export function RenameGroupDialog({
  group,
  onRenamed,
  onSessionExpired,
  ...dialog
}: RenameGroupDialogProps) {
  const [name, setName] = useState(group.name);
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Explanation | null>(null);
  const [pending, setPending] = useState(false);
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
    const result = await callApi(() =>
      api.PATCH("/api/v1/groups/{groupId}", {
        params: { path: { groupId: group.id } },
        body: { name },
      }),
    );
    inFlight.current = false;
    setPending(false);
    if (result.ok) {
      onRenamed(result.data.group);
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
      title="改组名"
      footer={
        <>
          <Button variant="secondary" onClick={dialog.onClose}>
            取消
          </Button>
          <Button type="submit" form="rename-group" disabled={pending} aria-busy={pending}>
            保存
          </Button>
        </>
      }
    >
      <form
        id="rename-group"
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
