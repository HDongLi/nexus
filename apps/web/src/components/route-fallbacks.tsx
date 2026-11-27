import { Button, Notice, PageBody, PageHeader, Panel, buttonClass } from "@nexus/ui-kit";
import { Link } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

/** 地址对不上任何一个页面。登录着的人看到它时侧栏还在，能从导航走开。 */
export function NotFoundPage() {
  return (
    <>
      <PageHeader title="找不到这个页面" />
      <PageBody>
        <Panel>
          <p className="text-ink-2">这个地址没有对应的页面，可能已经挪走了。</p>
          <div className="mt-4">
            <Link to="/" className={buttonClass()}>
              回首页
            </Link>
          </div>
        </Panel>
      </PageBody>
    </>
  );
}

/**
 * 哪个页面自己出了错（不是接口失败，接口失败在各自的卡里说）。说清楚出了什么，给一条走得通的路。
 */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  return (
    <>
      <PageHeader title="这个页面出了问题" />
      <PageBody>
        <Panel>
          <Notice tone="error" title="页面没能画出来">
            <p className="font-mono">{error instanceof Error ? error.message : String(error)}</p>
          </Notice>
          <div className="mt-4 flex gap-2">
            <Button onClick={reset}>
              <RefreshCw />
              再试一次
            </Button>
            <Link to="/" className={buttonClass({ variant: "secondary" })}>
              回首页
            </Link>
          </div>
        </Panel>
      </PageBody>
    </>
  );
}
