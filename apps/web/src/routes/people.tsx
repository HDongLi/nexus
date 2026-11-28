import { Button, ItemList, Notice, PageBody, PageHeader, Panel } from "@nexus/ui-kit";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, UserPlus } from "lucide-react";
import { useState } from "react";
import { AdminRequired } from "../components/admin-required.tsx";
import { CreateAccountDialog } from "../components/people/create-account-dialog.tsx";
import { UserRow } from "../components/people/user-row.tsx";
import { api, type Outcome } from "../lib/api.ts";
import { explainFailure, type Explanation } from "../lib/failure.ts";
import type { Account, AccountList } from "../lib/people.ts";
import { useCurrentUser, useExpireSession } from "../lib/session.ts";
import { useEndpoint } from "../lib/use-endpoint.ts";

export const Route = createFileRoute("/people")({
  head: () => ({ meta: [{ title: "人员 · nexus" }] }),
  component: PeopleRoute,
});

/**
 * 管理员的闸在页面这一层：非管理员给一张挡板卡，不发任何请求（规格 G-42）。
 * 「我是谁」在路由的闸里已经取好，这里只读缓存；取数组件只给管理员挂载。
 */
function PeopleRoute() {
  const me = useCurrentUser();
  if (me.data === undefined) {
    return (
      <>
        <PageHeader title="人员" />
        <PageBody>
          <p className="text-ink-2">正在确认身份……</p>
        </PageBody>
      </>
    );
  }
  if (!me.data.isAdmin) return <AdminRequired title="人员" />;
  return <PeoplePage />;
}

function PeoplePage() {
  const accounts = useEndpoint(["users", "list"], () => api.GET("/api/v1/users"));
  const expire = useExpireSession();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  // 行级失败（护栏的几种 409）按编号记账，常显在那一行下面（规格 G-41）。
  const [rowFailures, setRowFailures] = useState<Record<string, Explanation>>({});
  // 建过工程的账号删不掉（规格 G-24）：页面不预先猜谁建过，收到那次 409 才记住。
  const [undeletable, setUndeletable] = useState<Record<string, true>>({});

  const writeList = (update: (accounts: Account[]) => Account[]): void => {
    queryClient.setQueryData<Outcome<AccountList>>(["users", "list"], (old) => {
      if (old === undefined || !old.ok) return old;
      return { ok: true, data: { accounts: update(old.data.accounts) } };
    });
  };

  const onCreated = (): void => {
    setCreateOpen(false);
    // 清单按用户名升序回（规格 G-06）：取一次，顺序一定是对的，账号也不多。
    void accounts.refetch();
  };

  const onPatched = (next: Account): void =>
    writeList((list) => list.map((account) => (account.id === next.id ? next : account)));

  const onDeleted = (id: string): void =>
    writeList((list) => list.filter((account) => account.id !== id));

  const onRowFailure = (id: string, text: Explanation | null): void =>
    setRowFailures((current) => {
      const next = { ...current };
      if (text === null) delete next[id];
      else next[id] = text;
      return next;
    });

  const onUndeletable = (id: string): void =>
    setUndeletable((current) => ({ ...current, [id]: true }));

  const text = (): Explanation | null =>
    accounts.data && !accounts.data.ok
      ? explainFailure(accounts.data.failure, accounts.data.details)
      : null;
  const failure = text();

  const list = accounts.data?.ok === true ? accounts.data.data.accounts : undefined;

  return (
    <>
      <PageHeader
        title="人员"
        description="账号、管理员位与停用"
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="刷新"
              onClick={() => void accounts.refetch()}
            >
              <RefreshCw />
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus />
              新建账号
            </Button>
          </>
        }
      />
      <PageBody wide>
        <Panel title="人员清单" aria-label="人员清单">
          {list !== undefined ? (
            list.length > 0 ? (
              <ItemList aria-label="人员清单">
                {list.map((account) => (
                  <UserRow
                    key={account.id}
                    account={account}
                    deletable={undeletable[account.id] !== true}
                    failure={rowFailures[account.id]}
                    onPatched={onPatched}
                    onDeleted={onDeleted}
                    onRowFailure={onRowFailure}
                    onUndeletable={onUndeletable}
                  />
                ))}
              </ItemList>
            ) : (
              <div className="py-8 text-center">
                <p className="text-ink-2">还没有别的账号。新建第一个。</p>
                <div className="mt-4">
                  <Button onClick={() => setCreateOpen(true)}>
                    <UserPlus />
                    新建账号
                  </Button>
                </div>
              </div>
            )
          ) : null}
          {failure !== null ? (
            <Notice tone="error" title={failure.title} requestId={failure.requestId}>
              {failure.detail}
            </Notice>
          ) : null}
          {accounts.isPending ? <p className="text-ink-2">正在取人员……</p> : null}
        </Panel>
      </PageBody>
      {createOpen ? (
        <CreateAccountDialog
          onClose={() => setCreateOpen(false)}
          onCreated={onCreated}
          onSessionExpired={() => {
            setCreateOpen(false);
            expire();
          }}
        />
      ) : null}
    </>
  );
}
