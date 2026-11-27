import { Button, Notice, PasswordInput, TextInput } from "@nexus/ui-kit";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { BrandMark } from "../components/brand-mark.tsx";
import { api, callApi } from "../lib/api.ts";
import { safeRedirectTarget } from "../lib/auth-gate.ts";
import { withoutErrorIfFilled, type FieldErrors } from "../lib/field-errors.ts";
import { explainFailure, type Explanation } from "../lib/failure.ts";
import { meQuery, signedIn } from "../lib/session.ts";
import { useDelayedFlag } from "../lib/use-delayed-flag.ts";

interface LoginSearch {
  /** 登录后回到哪里。来自地址栏，用之前先过 safeRedirectTarget。 */
  next?: string;
}

type FormErrors = FieldErrors<"username" | "password">;

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch =>
    typeof search.next === "string" ? { next: search.next } : {},
  // 已经登录的人走到登录页，直接送去要去的地方。刚被闸拦下来的人（缓存里是「问过了、没登录」）不再问第二遍；
  // 新开的标签页还没问过，问一次。
  beforeLoad: async ({ context, search }) => {
    const state = context.queryClient.getQueryState(meQuery.queryKey);
    const user =
      state?.status === "success"
        ? state.data
        : state === undefined
          ? await context.queryClient.fetchQuery(meQuery).catch(() => undefined)
          : undefined;
    if (user !== undefined)
      throw redirect({ href: safeRedirectTarget(search.next), replace: true });
  },
  head: () => ({ meta: [{ title: "登录 · nexus" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const target = safeRedirectTarget(next);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<Explanation | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useDelayedFlag(pending);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // 提交在途的标记。按钮已经点了不能点，按状态判断要等界面重画，这里当场就拒绝第二次。
  const inFlight = useRef(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (inFlight.current) return;
    const local: FormErrors = {
      username: username.trim() === "" ? "请输入用户名" : undefined,
      password: password === "" ? "请输入口令" : undefined,
    };
    if (local.username !== undefined || local.password !== undefined) {
      setErrors(local);
      setFailure(null);
      (local.username !== undefined ? usernameRef : passwordRef).current?.focus();
      return;
    }
    // 这次填全了，上一次留在字段下面的那句话不再成立。
    setErrors({});
    inFlight.current = true;
    setPending(true);
    const result = await callApi(() =>
      api.POST("/api/v1/auth/login", { body: { username: username.trim(), password } }),
    );
    inFlight.current = false;
    setPending(false);
    if (!result.ok) {
      // 口令抹掉，焦点回到口令框：错的多半是它，重输一遍就行。
      setFailure(explainFailure(result.failure, result.details));
      setPassword("");
      passwordRef.current?.focus();
      return;
    }
    signedIn(queryClient, result.data.user);
    // 用路由器自己的跳转，不整页刷新：刚拿到的缓存还在，后面的页面不用再问「我是谁」。
    await navigate({ href: target, replace: true });
  };

  return (
    // 上下居中靠卡片自己的外边距，不靠容器的 items-center：窗口矮得放不下时，items-center 会把卡片顶出窗口上沿，
    // 外边距则缩成零，卡片从顶上开始、整页可以往下滚。
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 py-8">
      <div className="my-auto w-full max-w-sm rounded-card bg-card p-8 shadow-soft">
        <BrandMark className="size-8" strokeWidth={2.25} />
        <h1 className="mt-5 text-title font-semibold tracking-tight">登录到 nexus</h1>
        {failure ? (
          <Notice className="mt-6" tone="error" title={failure.title} requestId={failure.requestId}>
            {failure.detail}
          </Notice>
        ) : null}
        <form className="mt-6 space-y-4" noValidate onSubmit={(event) => void submit(event)}>
          <TextInput
            ref={usernameRef}
            label="用户名"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setErrors((current) => withoutErrorIfFilled(current, "username", event.target.value));
            }}
            error={errors.username}
          />
          <PasswordInput
            ref={passwordRef}
            label="口令"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setErrors((current) => withoutErrorIfFilled(current, "password", event.target.value));
            }}
            error={errors.password}
          />
          <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
            {busy ? "正在登录…" : "登录"}
          </Button>
        </form>
      </div>
    </main>
  );
}
