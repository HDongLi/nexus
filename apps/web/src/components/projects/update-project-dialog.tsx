import { Button, Dialog, Notice, TextInput, type DialogProps } from "@nexus/ui-kit";
import { useRef, useState, type FormEvent } from "react";
import { api, callApi } from "../../lib/api.ts";
import { withoutErrorIfFilled, type FieldErrors } from "../../lib/field-errors.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import type { Project } from "../../lib/projects.ts";

type Field = "displayName" | "avatar";

type FormErrors = FieldErrors<Field>;

export interface UpdateProjectDialogProps extends Omit<DialogProps, "title" | "footer"> {
  project: Project;
  /** 改成了：把接口回的那条交给页面，详情和清单跟着变。 */
  onUpdated: (project: Project) => void;
  onSessionExpired: () => void;
}

/**
 * 改显示名和头像字。两个字段清空提交就是清除（规格 P-30）：空串存进记录，
 * 页面上显示名回落成短名、头像字回落成显示内容的首个字符。短名不在这里——它建好就不能改。
 */
export function UpdateProjectDialog({
  project,
  onUpdated,
  onSessionExpired,
  ...dialog
}: UpdateProjectDialogProps) {
  const [displayName, setDisplayName] = useState(project.displayName);
  const [avatar, setAvatar] = useState(project.avatar);
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Explanation | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const retract = (field: Field, value: string): void =>
    setErrors((current) => withoutErrorIfFilled(current, field, value));

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const result = await callApi(() =>
      api.PATCH("/api/v1/projects/{projectId}", {
        params: { path: { projectId: project.id } },
        body: { displayName, avatar },
      }),
    );
    inFlight.current = false;
    setPending(false);
    if (result.ok) {
      onUpdated(result.data.project);
      return;
    }
    if (result.failure.code === "auth_required") {
      onSessionExpired();
      return;
    }
    setErrors({});
    setFailure(explainFailure(result.failure, result.details));
  };

  return (
    <Dialog
      {...dialog}
      title="改显示名"
      description="短名建好后不能改。清空一个字段就是清除它。"
      footer={
        <>
          <Button variant="secondary" onClick={dialog.onClose}>
            取消
          </Button>
          <Button type="submit" form="update-project" disabled={pending} aria-busy={pending}>
            保存
          </Button>
        </>
      }
    >
      <form
        id="update-project"
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
          hint="可选，最长 40。留空保存就是清除，页面上会显示短名。"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            retract("displayName", event.target.value);
          }}
          error={errors.displayName}
        />
        <TextInput
          label="头像字"
          name="avatar"
          hint="可选，一到两个字符。留空保存就是清除。"
          value={avatar}
          onChange={(event) => {
            setAvatar(event.target.value);
            retract("avatar", event.target.value);
          }}
          error={errors.avatar}
        />
      </form>
    </Dialog>
  );
}
