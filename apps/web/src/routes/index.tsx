import { type ApiFailure, type CallResult, failureOf } from "@nexus/api-client";
import {
  Button,
  DescriptionDetail,
  DescriptionList,
  DescriptionTerm,
  InlineCode,
  Notice,
  PageBody,
  PageHeader,
  Panel,
  StatusBadge,
  type StatusTone,
} from "@nexus/ui-kit";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, Info, RefreshCw } from "lucide-react";
import { api } from "../lib/api.ts";
import { explainFailure } from "../lib/failure.ts";
import { formatLocalTime } from "../lib/time.ts";

export const Route = createFileRoute("/")({
  component: SystemPage,
});

/** 调一个接口：成功的给数据，失败的给翻好的原因。页面只管显示。 */
function useEndpoint<T>(key: string[], call: () => Promise<CallResult & { data?: T }>) {
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<{ ok: true; data: T } | { ok: false; failure: ApiFailure }> => {
      // 失败只看有没有数据：响应体读不出来的时候，error 也是空的。
      const result = await call();
      if (result.data === undefined) return { ok: false, failure: failureOf(result) };
      return { ok: true, data: result.data };
    },
  });
}

const HEALTH_TEXT: Record<"ok" | "degraded", [StatusTone, string]> = {
  ok: ["ok", "正常"],
  degraded: ["fail", "降级"],
};

const CHECK_TEXT: Record<"ok" | "fail", [StatusTone, string]> = {
  ok: ["ok", "正常"],
  fail: ["fail", "故障"],
};

/** 给人看的时间用本地时区，鼠标悬停时给完整的标准格式，方便对日志。 */
function Moment({ value }: { value: string }) {
  return (
    <time dateTime={value} title={value} className="font-mono tabular-nums">
      {formatLocalTime(value)}
    </time>
  );
}

function SystemPage() {
  const health = useEndpoint(["system", "health"], () => api.GET("/api/v1/system/health"));
  const info = useEndpoint(["system", "info"], () => api.GET("/api/v1/system/info"));

  const refresh = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="刷新"
      onClick={() => {
        void health.refetch();
        void info.refetch();
      }}
    >
      <RefreshCw />
    </Button>
  );

  return (
    <>
      <PageHeader
        title="系统状态"
        description="后端在不在、是哪个版本、什么时候起的"
        actions={refresh}
      />
      <PageBody>
        <Panel title="健康状态" icon={<Activity />} aria-label="健康状态">
          {health.data?.ok ? (
            <DescriptionList>
              <DescriptionTerm>状态</DescriptionTerm>
              <DescriptionDetail>
                <StatusBadge tone={HEALTH_TEXT[health.data.data.status][0]}>
                  {HEALTH_TEXT[health.data.data.status][1]}
                </StatusBadge>
              </DescriptionDetail>
              <DescriptionTerm>版本</DescriptionTerm>
              <DescriptionDetail>
                <InlineCode>{health.data.data.version}</InlineCode>
              </DescriptionDetail>
              <DescriptionTerm>数据库</DescriptionTerm>
              <DescriptionDetail>
                <StatusBadge tone={CHECK_TEXT[health.data.data.checks.db][0]}>
                  {CHECK_TEXT[health.data.data.checks.db][1]}
                </StatusBadge>
              </DescriptionDetail>
              <DescriptionTerm>服务器时间</DescriptionTerm>
              <DescriptionDetail>
                <Moment value={health.data.data.time} />
              </DescriptionDetail>
            </DescriptionList>
          ) : null}
          {health.data && !health.data.ok ? (
            <Notice tone="error" title="连不上后端" requestId={health.data.failure.requestId}>
              {explainFailure(health.data.failure).detail}
            </Notice>
          ) : null}
          {health.isPending ? <p className="text-ink-2">正在问后端……</p> : null}
        </Panel>

        <Panel title="启动信息" icon={<Info />} aria-label="启动信息">
          {info.data?.ok ? (
            <DescriptionList>
              <DescriptionTerm>本次启动</DescriptionTerm>
              <DescriptionDetail>
                <Moment value={info.data.data.boot.startedAt} />
              </DescriptionDetail>
              <DescriptionTerm>启动编号</DescriptionTerm>
              <DescriptionDetail>
                <InlineCode>{info.data.data.boot.bootId}</InlineCode>
              </DescriptionDetail>
              <DescriptionTerm>最近启动</DescriptionTerm>
              <DescriptionDetail>{info.data.data.recentBoots.length} 次</DescriptionDetail>
            </DescriptionList>
          ) : null}
          {info.data && !info.data.ok ? (
            <Notice
              tone="error"
              title={explainFailure(info.data.failure).title}
              requestId={info.data.failure.requestId}
            >
              {explainFailure(info.data.failure).detail}
            </Notice>
          ) : null}
          {info.isPending ? <p className="text-ink-2">正在问后端……</p> : null}
        </Panel>
      </PageBody>
    </>
  );
}
