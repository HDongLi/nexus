import {
  Button,
  DescriptionDetail,
  DescriptionList,
  DescriptionTerm,
  InlineCode,
  ItemAvatar,
  Notice,
  PageBody,
  PageHeader,
  Panel,
  buttonClass,
} from "@nexus/ui-kit";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { UpdateProjectDialog } from "../../components/projects/update-project-dialog.tsx";
import { api, type Outcome } from "../../lib/api.ts";
import { explainFailure, type Explanation } from "../../lib/failure.ts";
import {
  avatarOf,
  displayNameOf,
  isProjectId,
  shortCommit,
  type Project,
  type ProjectDetail,
  type ProjectList,
} from "../../lib/projects.ts";
import { useCurrentUser, useExpireSession } from "../../lib/session.ts";
import { formatLocalTime } from "../../lib/time.ts";
import { useEndpoint } from "../../lib/use-endpoint.ts";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({ meta: [{ title: "工程详情 · nexus" }] }),
  component: ProjectDetailPage,
});

/** 给人看的时间，悬停给完整的标准格式。 */
function Moment({ value }: { value: string }) {
  return (
    <time dateTime={value} title={value} className="font-mono tabular-nums">
      {formatLocalTime(value)}
    </time>
  );
}

/** 编号不存在、或者看不见（服务端一律回 404，规格 P-11）：同一张卡，一条走得通的路。 */
function MissingProject() {
  return (
    <>
      <PageHeader title="工程" />
      <PageBody>
        <Panel>
          <p className="text-ink-2">这个工程不存在，或者你看不到它。</p>
          <div className="mt-4">
            <Link to="/projects" className={buttonClass()}>
              回工程清单
            </Link>
          </div>
        </Panel>
      </PageBody>
    </>
  );
}

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const detail = useEndpoint(["projects", "detail", projectId], () =>
    api.GET("/api/v1/projects/{projectId}", { params: { path: { projectId } } }),
  );
  const me = useCurrentUser();
  const expire = useExpireSession();
  const queryClient = useQueryClient();
  const [updateOpen, setUpdateOpen] = useState(false);
  const project = detail.data?.ok === true ? detail.data.data.project : undefined;

  // 「改显示名和头像字」只有创建者和管理员看得到（规格 P-29）：判断只用清单或详情里的
  // createdById 和「我是谁」里的 id、isAdmin，不另问接口。
  const canEdit = me.data !== undefined && (me.data.id === project?.createdById || me.data.isAdmin);

  if (!isProjectId(projectId)) return <MissingProject />;
  // 不是编号的形状就不问接口了：地址栏里手滑的地址，按不存在处理。
  if (detail.data && !detail.data.ok && detail.data.failure.code === "not_found")
    return <MissingProject />;

  // 改成了：详情里的记录换新的（最新提交不变），清单里的那一条也跟着换，两边不再各取一次。
  const onUpdated = (next: Project): void => {
    setUpdateOpen(false);
    queryClient.setQueryData<Outcome<{ project: ProjectDetail }>>(
      ["projects", "detail", projectId],
      (old) =>
        old !== undefined && old.ok
          ? { ok: true, data: { project: { ...old.data.project, ...next } } }
          : old,
    );
    queryClient.setQueryData<Outcome<ProjectList>>(["projects", "list"], (old) =>
      old !== undefined && old.ok
        ? {
            ok: true,
            data: {
              projects: old.data.projects.map((p) => (p.id === next.id ? { ...p, ...next } : p)),
            },
          }
        : old,
    );
  };

  const head = detail.data?.ok ? detail.data.data.project.head : undefined;
  const failureText = (): Explanation | null =>
    detail.data && !detail.data.ok
      ? explainFailure(detail.data.failure, detail.data.details)
      : null;
  const text = failureText();

  return (
    <>
      {detail.data?.ok ? (
        <PageHeader
          title={displayNameOf(detail.data.data.project)}
          actions={
            canEdit ? (
              <Button onClick={() => setUpdateOpen(true)}>
                <Pencil />
                改显示名
              </Button>
            ) : null
          }
        />
      ) : (
        <PageHeader title="工程详情" />
      )}
      <PageBody>
        {detail.data?.ok ? (
          <>
            <Panel title="基本信息">
              <div className="mb-4">
                <ItemAvatar
                  letter={avatarOf(detail.data.data.project)}
                  className="size-10 text-body"
                />
              </div>
              <DescriptionList>
                <DescriptionTerm>显示名</DescriptionTerm>
                <DescriptionDetail>{displayNameOf(detail.data.data.project)}</DescriptionDetail>
                <DescriptionTerm>短名</DescriptionTerm>
                <DescriptionDetail>
                  <InlineCode>{detail.data.data.project.slug}</InlineCode>
                </DescriptionDetail>
                <DescriptionTerm>头像字</DescriptionTerm>
                <DescriptionDetail>
                  {detail.data.data.project.avatar === "" ? (
                    <span className="text-ink-3">未设置</span>
                  ) : (
                    detail.data.data.project.avatar
                  )}
                </DescriptionDetail>
                <DescriptionTerm>创建时间</DescriptionTerm>
                <DescriptionDetail>
                  <Moment value={detail.data.data.project.createdAt} />
                </DescriptionDetail>
              </DescriptionList>
            </Panel>
            <Panel title="最新提交">
              {head !== undefined ? (
                <DescriptionList>
                  <DescriptionTerm>编号</DescriptionTerm>
                  <DescriptionDetail>
                    {/* 只显示前八位，悬停给全的，对日志时用。 */}
                    <InlineCode>
                      <span title={head.commitId}>{shortCommit(head.commitId)}</span>
                    </InlineCode>
                  </DescriptionDetail>
                  <DescriptionTerm>提交时间</DescriptionTerm>
                  <DescriptionDetail>
                    <Moment value={head.committedAt} />
                  </DescriptionDetail>
                  <DescriptionTerm>标题</DescriptionTerm>
                  <DescriptionDetail>{head.subject}</DescriptionDetail>
                </DescriptionList>
              ) : null}
            </Panel>
          </>
        ) : null}
        {text !== null ? (
          <Panel>
            <Notice tone="error" title={text.title} requestId={text.requestId}>
              {text.detail}
            </Notice>
          </Panel>
        ) : null}
        {detail.isPending ? <p className="text-ink-2">正在取工程……</p> : null}
      </PageBody>
      {updateOpen && detail.data?.ok ? (
        <UpdateProjectDialog
          project={detail.data.data.project}
          onClose={() => setUpdateOpen(false)}
          onUpdated={onUpdated}
          onSessionExpired={() => {
            setUpdateOpen(false);
            expire();
          }}
        />
      ) : null}
    </>
  );
}
