import {
  Button,
  ItemAvatar,
  ItemList,
  ItemMain,
  ItemMeta,
  itemRowClass,
  Notice,
  PageBody,
  PageHeader,
  Panel,
} from "@nexus/ui-kit";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { CreateProjectDialog } from "../../components/projects/create-project-dialog.tsx";
import { api, type Outcome } from "../../lib/api.ts";
import { explainFailure } from "../../lib/failure.ts";
import { avatarOf, displayNameOf, type Project, type ProjectList } from "../../lib/projects.ts";
import { useExpireSession } from "../../lib/session.ts";
import { formatLocalTime } from "../../lib/time.ts";
import { useEndpoint } from "../../lib/use-endpoint.ts";

export const Route = createFileRoute("/projects/")({
  head: () => ({ meta: [{ title: "工程 · nexus" }] }),
  component: ProjectsPage,
});

/** 创建时间。宽屏占行右侧的一列；窄屏行右没有空间，折进主列，缀在短名前面。 */
function CreatedAt({ value, aside }: { value: string; aside?: boolean }) {
  const stamp = (
    <time dateTime={value} title={value}>
      {formatLocalTime(value)}
    </time>
  );
  if (aside) return <ItemMeta className="hidden md:block">{stamp}</ItemMeta>;
  return (
    <span className="md:hidden">
      {stamp}
      {" · "}
    </span>
  );
}

/** 一行工程：头像字、显示名（空则短名）、短名、创建时间。整行是一个链接。 */
function ProjectRow({ project }: { project: Project }) {
  return (
    <li>
      <Link to="/projects/$projectId" params={{ projectId: project.id }} className={itemRowClass()}>
        <ItemAvatar letter={avatarOf(project)} />
        <ItemMain
          title={displayNameOf(project)}
          subtitle={
            <>
              <CreatedAt value={project.createdAt} />
              {project.slug}
            </>
          }
        />
        <CreatedAt value={project.createdAt} aside />
      </Link>
    </li>
  );
}

function ProjectsPage() {
  const projects = useEndpoint(["projects", "list"], () => api.GET("/api/v1/projects"));
  const queryClient = useQueryClient();
  const expire = useExpireSession();
  const [createOpen, setCreateOpen] = useState(false);

  // 新建成了就把接口回的那条并进清单缓存的最前（接口按创建时间降序，新的在前）：
  // 不再发一次清单请求，清单立刻有它，也不闪一下「正在取」。
  const onCreated = (project: Project): void => {
    setCreateOpen(false);
    queryClient.setQueryData<Outcome<ProjectList>>(["projects", "list"], (old) => {
      if (old === undefined || !old.ok) return { ok: true, data: { projects: [project] } };
      return { ok: true, data: { projects: [project, ...old.data.projects] } };
    });
  };

  const refresh = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="刷新"
      onClick={() => void projects.refetch()}
    >
      <RefreshCw />
    </Button>
  );

  return (
    <>
      <PageHeader
        title="工程"
        description="看得见的工程，新的在前"
        actions={
          <>
            {refresh}
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              新建工程
            </Button>
          </>
        }
      />
      <PageBody wide>
        <Panel title="工程清单" aria-label="工程清单">
          {projects.data?.ok ? (
            projects.data.data.projects.length > 0 ? (
              <ItemList aria-label="工程清单">
                {projects.data.data.projects.map((project) => (
                  <ProjectRow key={project.id} project={project} />
                ))}
              </ItemList>
            ) : (
              // 空清单给一句引导，不是一张空表（规格 P-38）。
              <div className="py-8 text-center">
                <p className="text-ink-2">还没有工程。新建第一个。</p>
                <div className="mt-4">
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus />
                    新建工程
                  </Button>
                </div>
              </div>
            )
          ) : null}
          {projects.data && !projects.data.ok ? (
            <Notice
              tone="error"
              title={explainFailure(projects.data.failure).title}
              requestId={explainFailure(projects.data.failure).requestId}
            >
              {explainFailure(projects.data.failure).detail}
            </Notice>
          ) : null}
          {projects.isPending ? <p className="text-ink-2">正在取工程……</p> : null}
        </Panel>
      </PageBody>
      {createOpen ? (
        <CreateProjectDialog
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
