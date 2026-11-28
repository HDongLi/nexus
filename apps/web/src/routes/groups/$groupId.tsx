import {
  Button,
  ConfirmButton,
  ItemList,
  Notice,
  PageBody,
  PageHeader,
  Panel,
  StatusBadge,
  buttonClass,
} from "@nexus/ui-kit";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderGit2, Pencil, UserPlus, UsersRound } from "lucide-react";
import { useState } from "react";
import { avatarLetter } from "../../components/account-menu.tsx";
import { AdminRequired } from "../../components/admin-required.tsx";
import { RenameGroupDialog } from "../../components/groups/rename-group-dialog.tsx";
import { DisabledBadge, PickRow } from "../../components/groups/pick-row.tsx";
import { api, callApi, type Outcome } from "../../lib/api.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import {
  accountTitle,
  findPerson,
  isUuid,
  shortId,
  type Group,
  type GroupList,
} from "../../lib/people.ts";
import { avatarOf, displayNameOf, type Project } from "../../lib/projects.ts";
import { useCurrentUser, useExpireSession } from "../../lib/session.ts";
import { useEndpoint } from "../../lib/use-endpoint.ts";

export const Route = createFileRoute("/groups/$groupId")({
  head: () => ({ meta: [{ title: "用户组详情 · nexus" }] }),
  component: GroupDetailRoute,
});

/** 管理员的闸在页面这一层（规格 G-42），和清单页共用一张挡板卡。 */
function GroupDetailRoute() {
  const me = useCurrentUser();
  if (me.data === undefined) {
    return (
      <>
        <PageHeader title="用户组详情" />
        <PageBody>
          <p className="text-ink-2">正在确认身份……</p>
        </PageBody>
      </>
    );
  }
  if (!me.data.isAdmin) return <AdminRequired title="用户组详情" />;
  return <GroupDetailPage />;
}

function MissingGroup() {
  return (
    <>
      <PageHeader title="用户组详情" />
      <PageBody>
        <Panel>
          <p className="text-ink-2">这个用户组不存在，或者已经被删掉了。</p>
          <div className="mt-4">
            <Link to="/groups" className={buttonClass()}>
              回用户组清单
            </Link>
          </div>
        </Panel>
      </PageBody>
    </>
  );
}

function GroupDetailPage() {
  const { groupId } = Route.useParams();
  const group = useEndpoint(["groups", "detail", groupId], () =>
    api.GET("/api/v1/groups/{groupId}", { params: { path: { groupId } } }),
  );
  // 成员问身份模块，可见的工程问工程模块，两块分开取数（规格 G-31）。
  const people = useEndpoint(["people"], () => api.GET("/api/v1/people"));
  const projects = useEndpoint(["projects", "list"], () => api.GET("/api/v1/projects"));
  const visible = useEndpoint(["groups", "projects", groupId], () =>
    api.GET("/api/v1/groups/{groupId}/projects", { params: { path: { groupId } } }),
  );
  const expire = useExpireSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [membersError, setMembersError] = useState<Explanation | null>(null);
  const [projectsError, setProjectsError] = useState<Explanation | null>(null);
  const [deleteError, setDeleteError] = useState<Explanation | null>(null);

  if (!isUuid(groupId)) return <MissingGroup />;
  if (group.data && !group.data.ok && group.data.failure.code === "not_found")
    return <MissingGroup />;

  const groupData = group.data?.ok === true ? group.data.data.group : undefined;
  const peopleData = people.data?.ok === true ? people.data.data.people : undefined;
  const projectList = projects.data?.ok === true ? projects.data.data.projects : undefined;
  const visibleIds = visible.data?.ok === true ? visible.data.data.projectIds : undefined;

  /** 组的一条换进详情缓存，清单里的那一条也跟着换，两边不再各取一次。 */
  const applyGroup = (next: Group): void => {
    queryClient.setQueryData<Outcome<{ group: Group }>>(["groups", "detail", groupId], (old) =>
      old !== undefined && old.ok ? { ok: true, data: { group: next } } : old,
    );
    queryClient.setQueryData<Outcome<GroupList>>(["groups", "list"], (old) =>
      old !== undefined && old.ok
        ? {
            ok: true,
            data: { groups: old.data.groups.map((g) => (g.id === next.id ? next : g)) },
          }
        : old,
    );
  };

  /** 成员是整体替换（规格 G-28）：页面提交的数组就是替换后的全集。 */
  const setMembers = async (userIds: string[]): Promise<void> => {
    const result = await callApi(() =>
      api.PUT("/api/v1/groups/{groupId}/members", {
        params: { path: { groupId } },
        body: { userIds },
      }),
    );
    if (result.ok) {
      applyGroup(result.data.group);
      setMembersError(null);
      return;
    }
    if (result.failure.code === "auth_required") {
      expire();
      return;
    }
    setMembersError(explainFailure(result.failure, result.details));
  };

  const setVisible = async (projectIds: string[]): Promise<void> => {
    const result = await callApi(() =>
      api.PUT("/api/v1/groups/{groupId}/projects", {
        params: { path: { groupId } },
        body: { projectIds },
      }),
    );
    if (result.ok) {
      const next: Outcome<{ projectIds: string[] }> = {
        ok: true,
        data: { projectIds: result.data.projectIds },
      };
      queryClient.setQueryData(["groups", "projects", groupId], next);
      setProjectsError(null);
      return;
    }
    if (result.failure.code === "auth_required") {
      expire();
      return;
    }
    setProjectsError(explainFailure(result.failure, result.details));
  };

  const removeGroup = async (): Promise<void> => {
    const result = await callApi(() =>
      api.DELETE("/api/v1/groups/{groupId}", { params: { path: { groupId } } }),
    );
    if (result.ok) {
      queryClient.setQueryData<Outcome<GroupList>>(["groups", "list"], (old) =>
        old !== undefined && old.ok
          ? { ok: true, data: { groups: old.data.groups.filter((g) => g.id !== groupId) } }
          : old,
      );
      await navigate({ to: "/groups" });
      return;
    }
    if (result.failure.code === "auth_required") {
      expire();
      return;
    }
    setDeleteError(explainFailure(result.failure, result.details));
  };

  const memberIds = groupData?.memberIds ?? [];
  const members = memberIds.map((id) => ({
    id,
    person: peopleData === undefined ? undefined : findPerson(id, peopleData),
  }));
  const addable = (peopleData ?? []).filter((person) => !memberIds.includes(person.id));

  return (
    <>
      <PageHeader
        title={groupData?.name ?? "用户组详情"}
        actions={
          groupData !== undefined ? (
            <>
              <Button variant="secondary" onClick={() => setRenameOpen(true)}>
                <Pencil />
                改名
              </Button>
              <ConfirmButton
                variant="outline"
                className="text-destructive"
                onConfirm={() => void removeGroup()}
                confirmTitle="成员关系和可见工程一起删掉；账号和工程本身不受影响。"
              >
                删除组
              </ConfirmButton>
            </>
          ) : null
        }
      />
      <PageBody wide>
        {group.isPending ? <p className="text-ink-2">正在取用户组……</p> : null}
        {group.data && !group.data.ok ? (
          <Panel>
            <Notice
              tone="error"
              title={explainFailure(group.data.failure, group.data.details).title}
              requestId={explainFailure(group.data.failure, group.data.details).requestId}
            >
              {explainFailure(group.data.failure, group.data.details).detail}
            </Notice>
          </Panel>
        ) : null}
        {deleteError !== null ? (
          <Panel>
            <Notice tone="error" title={deleteError.title} requestId={deleteError.requestId}>
              {deleteError.detail}
            </Notice>
          </Panel>
        ) : null}

        {groupData !== undefined ? (
          <>
            <Panel title={`成员（${memberIds.length}）`} icon={<UsersRound />} aria-label="组成员">
              {membersError !== null ? (
                <Notice
                  tone="error"
                  title={membersError.title}
                  requestId={membersError.requestId}
                  className="mb-3"
                >
                  {membersError.detail}
                </Notice>
              ) : null}
              {members.length > 0 ? (
                <ItemList aria-label="组成员清单">
                  {members.map(({ id, person }) => (
                    <PickRow
                      key={id}
                      letter={person !== undefined ? avatarLetter(accountTitle(person)) : "?"}
                      title={
                        person !== undefined ? (
                          accountTitle(person)
                        ) : (
                          <span className="font-mono">{shortId(id)}</span>
                        )
                      }
                      subtitle={
                        person !== undefined ? `@${person.username}` : `编号前八位 ${shortId(id)}`
                      }
                      badge={
                        person === undefined && peopleData !== undefined ? <DisabledBadge /> : null
                      }
                      actionLabel="移出"
                      onAction={() => setMembers(memberIds.filter((member) => member !== id))}
                    />
                  ))}
                </ItemList>
              ) : (
                <p className="text-ink-2">这个组还没有成员。从下面的同事里加。</p>
              )}
            </Panel>

            <Panel title="可添加的同事" icon={<UserPlus />} aria-label="可添加的同事">
              {people.data && !people.data.ok ? (
                <Notice
                  tone="error"
                  title={explainFailure(people.data.failure, people.data.details).title}
                >
                  {explainFailure(people.data.failure, people.data.details).detail}
                </Notice>
              ) : people.isPending ? (
                <p className="text-ink-2">正在取同事名录……</p>
              ) : addable.length > 0 ? (
                <ItemList aria-label="可添加的同事清单">
                  {addable.map((person) => (
                    <PickRow
                      key={person.id}
                      letter={avatarLetter(accountTitle(person))}
                      title={accountTitle(person)}
                      subtitle={`@${person.username}`}
                      actionLabel="加入"
                      onAction={() => setMembers([...memberIds, person.id])}
                    />
                  ))}
                </ItemList>
              ) : (
                <p className="text-ink-2">同事都在组里了。要加的人先在人员页建号。</p>
              )}
            </Panel>

            <Panel title="可见的工程" icon={<FolderGit2 />} aria-label="可见的工程">
              {projectsError !== null ? (
                <Notice
                  tone="error"
                  title={projectsError.title}
                  requestId={projectsError.requestId}
                  className="mb-3"
                >
                  {projectsError.detail}
                </Notice>
              ) : null}
              {visible.data && !visible.data.ok ? (
                <Notice
                  tone="error"
                  title={explainFailure(visible.data.failure, visible.data.details).title}
                >
                  {explainFailure(visible.data.failure, visible.data.details).detail}
                </Notice>
              ) : null}
              {projects.isPending || visible.isPending ? (
                <p className="text-ink-2">正在取工程……</p>
              ) : projectList !== undefined && visibleIds !== undefined ? (
                projectList.length > 0 ? (
                  <ItemList aria-label="工程加选清单">
                    {projectList.map((project: Project) => {
                      const shown = visibleIds.includes(project.id);
                      return (
                        <PickRow
                          key={project.id}
                          letter={avatarOf(project)}
                          title={displayNameOf(project)}
                          subtitle={project.slug}
                          badge={shown ? <StatusBadge tone="ok">组内可见</StatusBadge> : null}
                          actionLabel={shown ? "移出" : "加入"}
                          onAction={() =>
                            setVisible(
                              shown
                                ? visibleIds.filter((id) => id !== project.id)
                                : [...visibleIds, project.id],
                            )
                          }
                        />
                      );
                    })}
                  </ItemList>
                ) : (
                  <p className="text-ink-2">还没有工程。先在工程页建一个，再来给组看。</p>
                )
              ) : null}
            </Panel>
          </>
        ) : null}
      </PageBody>
      {renameOpen && groupData !== undefined ? (
        <RenameGroupDialog
          group={groupData}
          onClose={() => setRenameOpen(false)}
          onRenamed={(next) => {
            setRenameOpen(false);
            applyGroup(next);
          }}
          onSessionExpired={() => {
            setRenameOpen(false);
            expire();
          }}
        />
      ) : null}
    </>
  );
}
