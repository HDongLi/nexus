import type { paths } from "@nexus/api-client";

type ListOk = NonNullable<
  paths["/api/v1/projects"]["get"]["responses"][200]
>["content"]["application/json"];
type DetailOk = NonNullable<
  paths["/api/v1/projects/{projectId}"]["get"]["responses"][200]
>["content"]["application/json"];

/** 一条工程记录。形状来自生成的契约，与清单、新建、改回的是同一个。 */
export type Project = NonNullable<ListOk>["projects"][number];

/** 工程详情：记录加最新一次提交。 */
export type ProjectDetail = NonNullable<DetailOk>["project"];

/** 清单接口的成功回体。 */
export type ProjectList = NonNullable<ListOk>;

/** 显示名空着就回落成短名（规格 P-30）。 */
export function displayNameOf(project: Pick<Project, "slug" | "displayName">): string {
  return project.displayName === "" ? project.slug : project.displayName;
}

/**
 * 头像字空着就回落成显示内容的首个字符（规格 P-30、P-37）：先看头像字，再看显示名，
 * 显示名也空才轮到短名。这里只能给一个字符，什么都不剩时给问号。
 */
export function avatarOf(project: Pick<Project, "slug" | "displayName" | "avatar">): string {
  if (project.avatar !== "") return project.avatar;
  const first = Array.from(displayNameOf(project))[0];
  return first ?? "?";
}

/** 提交编号给人看的前八位；悬停时能看到全的，由调用方拿原值去设 title。 */
export function shortCommit(commitId: string): string {
  return commitId.slice(0, 8);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 地址里的工程编号是不是编号的形状。不是的（手滑、别人发来的半截地址）直接当不存在处理，
 * 不必去问接口要一个「请求不合法」：那是给程序调用者的话，不是给顺着链接来的人的。
 */
export function isProjectId(value: string): boolean {
  return UUID.test(value);
}
