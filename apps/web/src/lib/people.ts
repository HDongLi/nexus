import type { paths } from "@nexus/api-client";

type UsersOk = NonNullable<
  paths["/api/v1/users"]["get"]["responses"][200]
>["content"]["application/json"];
type PeopleOk = NonNullable<
  paths["/api/v1/people"]["get"]["responses"][200]
>["content"]["application/json"];
type GroupsOk = NonNullable<
  paths["/api/v1/groups"]["get"]["responses"][200]
>["content"]["application/json"];

/** 一条账号记录：人员清单、建号、改号、停用启用回的都是它，恰好七个键（规格 G-06）。 */
export type Account = NonNullable<UsersOk>["accounts"][number];

/** 人员清单接口的成功回体。 */
export type AccountList = NonNullable<UsersOk>;

/** 同事名录里的一条：四个键，只列启用的（规格 G-07）。 */
export type Person = NonNullable<PeopleOk>["people"][number];

/** 同事名录接口的成功回体。 */
export type PeopleList = NonNullable<PeopleOk>;

/** 一条用户组：五个键；可见的工程另问工程模块（规格 G-31）。 */
export type Group = NonNullable<GroupsOk>["groups"][number];

/** 用户组清单接口的成功回体，创建早的在前。 */
export type GroupList = NonNullable<GroupsOk>;

/** 显示名空着就回落成用户名（规格 G-12：空串表示没有显示名）。 */
export function accountTitle(account: Pick<Account, "username" | "displayName">): string {
  return account.displayName === "" ? account.username : account.displayName;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 地址里的用户组编号是不是编号的形状。不是的（手滑、别人发来的半截地址）直接当不存在处理，
 * 不必去问接口——和工程详情的同一个道理（lib/projects.ts 的 isProjectId）。
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** 编号给人看的前八位；工程详情的创建者回落、组里已停用的成员都用它（规格 G-07 的推论）。 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * 在同事名录里找一个人。名录只列启用的（G-07），建过工程的账号删不掉（G-21）：
 * 所以查不到就是这个人已停用，页面显示编号前八位加「已停用」小标。
 */
export function findPerson(id: string, people: readonly Person[]): Person | undefined {
  return people.find((person) => person.id === id);
}

/** 同事名录里那条给人看的名字：显示名（用户名）。显示名空着就只用用户名，不重复说一遍。 */
export function personLabel(person: Person): string {
  const title = accountTitle(person);
  return title === person.username ? title : `${title}（${person.username}）`;
}
