import {
  Button,
  Dialog,
  Notice,
  PasswordInput,
  Switch,
  TextInput,
  type DialogProps,
} from "@nexus/ui-kit";
import { useRef, useState, type FormEvent } from "react";
import { api, callApi } from "../../lib/api.ts";
import { withoutErrorIfFilled, type FieldErrors } from "../../lib/field-errors.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import type { Account } from "../../lib/people.ts";
import { useDelayedFlag } from "../../lib/use-delayed-flag.ts";

type Field = "username" | "password";

type FormErrors = FieldErrors<Field>;

/** 哪些失败是哪一个字段的事：挨着那个字段说（重名挨着用户名，规格的任务书明说了这条）。 */
const FIELD_OF: Record<string, Field> = {
  identity_username_taken: "username",
  auth_password_too_weak: "password",
};

/** 用户名的规则先在页面上挡一遍，和契约里的 pattern 一致；口令的长短是服务器配置，页面不猜。 */
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const USERNAME_HINT = "字母、数字、下划线、连字符，最长 64。建好后不能改。";

export interface CreateAccountDialogProps extends Omit<DialogProps, "title" | "footer"> {
  /** 建成了：把接口回的那条交给清单页。 */
  onCreated: (account: Account) => void;
  /** 会话没了的话别留着对话框：交还给外壳，它会把人送回登录页。 */
  onSessionExpired: () => void;
}

/**
 * 新建账号：用户名（必填）、显示名（可选）、初始口令（必填）、管理员位。
 * 建号一律要口令（规格 G-11），没有占位号。失败原因常显在对话框里，不用浏览器原生弹窗。
 */
export function CreateAccountDialog({
  onCreated,
  onSessionExpired,
  ...dialog
}: CreateAccountDialogProps) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Explanation | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useDelayedFlag(pending);
  const inFlight = useRef(false);
  const inputs = {
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
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
      username:
        username === ""
          ? "请输入用户名"
          : USERNAME_PATTERN.test(username)
            ? undefined
            : USERNAME_HINT,
      password: password === "" ? "请输入初始口令" : undefined,
    };
    if (local.username !== undefined || local.password !== undefined) {
      fail(local);
      return;
    }
    // 这次填对了，上一次留在字段下面的那句话不再成立。
    setErrors({});
    inFlight.current = true;
    setPending(true);
    const result = await callApi(() =>
      api.POST("/api/v1/users", {
        body: { username, password, displayName, isAdmin },
      }),
    );
    inFlight.current = false;
    setPending(false);
    if (result.ok) {
      onCreated(result.data.account);
      return;
    }
    if (result.failure.code === "auth_required") {
      onSessionExpired();
      return;
    }
    const text = explainFailure(result.failure, result.details);
    const field = FIELD_OF[result.failure.code];
    // 字段的失败挨着字段说，焦点回到那里，人改完就能再交；其余的用提示条常显在对话框里。
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
      title="新建账号"
      description="建一个能登录的账号。口令请交给本人，他可以在账号菜单里自己改。"
      footer={
        <>
          <Button variant="secondary" onClick={dialog.onClose}>
            取消
          </Button>
          <Button type="submit" form="create-account" disabled={pending} aria-busy={pending}>
            {busy ? "正在创建…" : "创建"}
          </Button>
        </>
      }
    >
      <form
        id="create-account"
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
          ref={inputs.username}
          data-autofocus
          label="用户名"
          name="username"
          hint={USERNAME_HINT}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            retract("username", event.target.value);
          }}
          error={errors.username}
        />
        <TextInput
          label="显示名"
          name="displayName"
          hint="可选，最长 64。留空就和用户名一样。"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <PasswordInput
          ref={inputs.password}
          label="初始口令"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            retract("password", event.target.value);
          }}
          error={errors.password}
        />
        <Switch
          label="管理员"
          hint="管理员能进人员页和用户组页，看得见所有工程。"
          checked={isAdmin}
          onCheckedChange={setIsAdmin}
        />
      </form>
    </Dialog>
  );
}
