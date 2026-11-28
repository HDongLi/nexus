import { Button, Dialog, Notice, TextInput, type DialogProps } from "@nexus/ui-kit";
import { useRef, useState, type FormEvent } from "react";
import { api, callApi } from "../../lib/api.ts";
import { withoutErrorIfFilled, type FieldErrors } from "../../lib/field-errors.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import type { Project } from "../../lib/projects.ts";
import { useDelayedFlag } from "../../lib/use-delayed-flag.ts";

type Field = "slug" | "displayName" | "avatar";

type FormErrors = FieldErrors<Field>;

/** 短名的规则先在页面上挡一遍：能就地说的不劳服务器，新建一次要跑好几条 git（规格 P-13）。 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const SLUG_HINT = "小写字母、数字、连字符，最长 64。建好后不能改。";

export interface CreateProjectDialogProps extends Omit<DialogProps, "title" | "footer"> {
  /** 建成了：把接口回的那条交给清单页并进它的缓存。 */
  onCreated: (project: Project) => void;
  /** 会话没了的话别留着对话框：交还给外壳，它会把人送回登录页。 */
  onSessionExpired: () => void;
}

/**
 * 新建工程：短名（必填）、显示名、头像字。新建比别的接口慢（服务端要建仓库），
 * 提交中按钮锁住，字换成「正在创建…」，不让人以为没点上。
 * 失败原因常显在对话框里：重名挨着短名字段说，其余用提示条（不用浏览器原生弹窗）。
 */
export function CreateProjectDialog({
  onCreated,
  onSessionExpired,
  ...dialog
}: CreateProjectDialogProps) {
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Explanation | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useDelayedFlag(pending);
  // 提交在途的标记：按钮已经点了不能点，这里当场拒绝第二次，不等界面重画。
  const inFlight = useRef(false);
  const slugRef = useRef<HTMLInputElement>(null);

  const retract = (field: Field, value: string): void =>
    setErrors((current) => withoutErrorIfFilled(current, field, value));

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (inFlight.current) return;
    const local: FormErrors = {
      slug: slug === "" ? "请输入短名" : SLUG_PATTERN.test(slug) ? undefined : SLUG_HINT,
    };
    if (local.slug !== undefined) {
      setErrors(local);
      setFailure(null);
      slugRef.current?.focus();
      return;
    }
    // 这次填对了，上一次留在字段下面的那句话不再成立。
    setErrors({});
    inFlight.current = true;
    setPending(true);
    const result = await callApi(() =>
      api.POST("/api/v1/projects", {
        body: { slug, displayName, avatar },
      }),
    );
    inFlight.current = false;
    setPending(false);
    if (result.ok) {
      onCreated(result.data.project);
      return;
    }
    if (result.failure.code === "auth_required") {
      onSessionExpired();
      return;
    }
    const text = explainFailure(result.failure, result.details);
    if (result.failure.code === "projects_slug_taken") {
      // 重名是短名这一个字段的事：挨着它说，焦点回到短名框，人改完就能再交。
      setErrors({ slug: text.title });
      setFailure(null);
      slugRef.current?.focus();
      return;
    }
    setFailure(text);
  };

  return (
    <Dialog
      {...dialog}
      title="新建工程"
      description="建一个仓库，平台替你管着。"
      footer={
        <>
          <Button variant="secondary" onClick={dialog.onClose}>
            取消
          </Button>
          <Button type="submit" form="create-project" disabled={pending} aria-busy={pending}>
            {busy ? "正在创建…" : "创建"}
          </Button>
        </>
      }
    >
      <form
        id="create-project"
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
          ref={slugRef}
          data-autofocus
          label="短名"
          name="slug"
          hint={SLUG_HINT}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value);
            retract("slug", event.target.value);
          }}
          error={errors.slug}
        />
        <TextInput
          label="显示名"
          name="displayName"
          hint="可选，给人看的名字，最长 40。留空就用短名。"
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
          hint="可选，一到两个字符。留空就用显示内容的首个字符。"
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
