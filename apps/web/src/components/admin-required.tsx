import { Notice, PageBody, PageHeader, Panel, buttonClass } from "@nexus/ui-kit";
import { Link } from "@tanstack/react-router";

/**
 * 「需要管理员」的挡板卡（规格 G-42）：非管理员直接输地址进管理页时给的一张卡。
 * 关键是不发请求——管理页的取数都住在管理员才挂载的那层组件里，这一层只管把话说清楚。
 */
export function AdminRequired({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <PageBody>
        <Panel>
          <Notice tone="info" title="需要管理员">
            这一页只有管理员能打开。找管理员开通，或者用管理员账号重新登录。
          </Notice>
          <div className="mt-4">
            <Link to="/" className={buttonClass({ variant: "secondary" })}>
              回首页
            </Link>
          </div>
        </Panel>
      </PageBody>
    </>
  );
}
