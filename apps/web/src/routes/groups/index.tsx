import {
  Button,
  ItemAvatar,
  ItemList,
  ItemMain,
  ItemMeta,
  Notice,
  PageBody,
  PageHeader,
  Panel,
  itemRowClass,
} from "@nexus/ui-kit";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { RefreshCw, UsersRound } from "lucide-react";
import { useState } from "react";
import { AdminRequired } from "../../components/admin-required.tsx";
import { CreateGroupDialog } from "../../components/groups/create-group-dialog.tsx";
import { avatarLetter } from "../../components/account-menu.tsx";
import { api, type Outcome } from "../../lib/api.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import type { Group, GroupList } from "../../lib/people.ts";
import { useCurrentUser, useExpireSession } from "../../lib/session.ts";
import { formatLocalTime } from "../../lib/time.ts";
import { useEndpoint } from "../../lib/use-endpoint.ts";

export const Route = createFileRoute("/groups/")({
  head: () => ({ meta: [{ title: "用户组 · nexus" }] }),
  component: GroupsRoute,
});

/** 管理员的闸在页面这一层：非管理员给一张挡板卡，不发任何请求（规格 G-42）。 */
function GroupsRoute() {
  const me = useCurrentUser();
  if (me.data === undefined) {
    return (
      <>
        <PageHeader title="用户组" />
        <PageBody>
          <p className="text-ink-2">正在确认身份……</p>
        </PageBody>
      </>
    );
  }
  if (!me.data.isAdmin) return <AdminRequired title="用户组" />;
  return <GroupsPage />;
}

/** 一行用户组：头像字、组名、成员数与创建时间。整行是通往详情的链接。 */
function GroupRow({ group }: { group: Group }) {
  return (
    <li>
      <Link to="/groups/$groupId" params={{ groupId: group.id }} className={itemRowClass()}>
        <ItemAvatar letter={avatarLetter(group.name)} />
        <ItemMain title={group.name} subtitle={`${group.memberIds.length} 名成员`} />
        <ItemMeta>
          <time dateTime={group.createdAt} title={group.createdAt}>
            {formatLocalTime(group.createdAt)}
          </time>
        </ItemMeta>
      </Link>
    </li>
  );
}

function GroupsPage() {
  const groups = useEndpoint(["groups", "list"], () => api.GET("/api/v1/groups"));
  const expire = useExpireSession();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  // 清单创建早的在前（规格 G-01）：新组加在末尾，顺序不用重取。
  const onCreated = (group: Group): void => {
    setCreateOpen(false);
    queryClient.setQueryData<Outcome<GroupList>>(["groups", "list"], (old) => {
      if (old === undefined || !old.ok) return { ok: true, data: { groups: [group] } };
      return { ok: true, data: { groups: [...old.data.groups, group] } };
    });
  };

  const failure = (): Explanation | null =>
    groups.data && !groups.data.ok
      ? explainFailure(groups.data.failure, groups.data.details)
      : null;
  const text = failure();

  const list = groups.data?.ok === true ? groups.data.data.groups : undefined;

  return (
    <>
      <PageHeader
        title="用户组"
        description="把同事划进组，组看得见哪些工程，成员就看得见"
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="刷新"
              onClick={() => void groups.refetch()}
            >
              <RefreshCw />
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <UsersRound />
              新建用户组
            </Button>
          </>
        }
      />
      <PageBody wide>
        <Panel title="用户组清单" aria-label="用户组清单">
          {list !== undefined ? (
            list.length > 0 ? (
              <ItemList aria-label="用户组清单">
                {list.map((group) => (
                  <GroupRow key={group.id} group={group} />
                ))}
              </ItemList>
            ) : (
              <div className="py-8 text-center">
                <p className="text-ink-2">还没有用户组。新建第一个。</p>
                <div className="mt-4">
                  <Button onClick={() => setCreateOpen(true)}>
                    <UsersRound />
                    新建用户组
                  </Button>
                </div>
              </div>
            )
          ) : null}
          {text !== null ? (
            <Notice tone="error" title={text.title} requestId={text.requestId}>
              {text.detail}
            </Notice>
          ) : null}
          {groups.isPending ? <p className="text-ink-2">正在取用户组……</p> : null}
        </Panel>
      </PageBody>
      {createOpen ? (
        <CreateGroupDialog
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
