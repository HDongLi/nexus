import { type ApiFailure, type CallResult, failureOf } from "@nexus/api-client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Notice } from "@nexus/ui-kit";
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { explainFailure } from "../lib/failure.ts";

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

function SystemPage() {
  const health = useEndpoint(["system", "health"], () => api.GET("/api/v1/system/health"));
  const info = useEndpoint(["system", "info"], () => api.GET("/api/v1/system/info"));
  const now = useClock();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">nexus</h1>
        <p className="text-muted-foreground">
          这是骨架的第一页：证明从页面到数据库的整条链路是通的。
        </p>
      </header>

      <section className="space-y-3" aria-label="健康状态">
        <h2 className="text-lg font-medium">健康状态</h2>
        {health.data?.ok ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">状态</dt>
            <dd>
              <span
                className={health.data.data.status === "ok" ? "text-emerald-700" : "text-red-700"}
              >
                {health.data.data.status}
              </span>
            </dd>
            <dt className="text-muted-foreground">版本</dt>
            <dd className="font-mono">{health.data.data.version}</dd>
            <dt className="text-muted-foreground">数据库</dt>
            <dd>{health.data.data.checks.db}</dd>
            <dt className="text-muted-foreground">服务器时间</dt>
            <dd className="font-mono">{health.data.data.time}</dd>
          </dl>
        ) : null}
        {health.data && !health.data.ok ? (
          <Notice tone="error" title="连不上后端" requestId={health.data.failure.requestId}>
            {explainFailure(health.data.failure).detail}
          </Notice>
        ) : null}
        {health.isPending ? <p className="text-sm text-muted-foreground">正在问后端……</p> : null}
      </section>

      <section className="space-y-3" aria-label="启动信息">
        <h2 className="text-lg font-medium">启动信息</h2>
        {info.data?.ok ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">本次启动</dt>
            <dd className="font-mono">{info.data.data.boot.startedAt}</dd>
            <dt className="text-muted-foreground">启动编号</dt>
            <dd className="font-mono">{info.data.data.boot.bootId}</dd>
            <dt className="text-muted-foreground">最近启动</dt>
            <dd>{info.data.data.recentBoots.length} 次</dd>
          </dl>
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
      </section>

      <footer className="text-xs text-muted-foreground">浏览器时间 {now}</footer>
    </div>
  );
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
