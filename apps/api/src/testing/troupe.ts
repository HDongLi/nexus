import type { Db } from "@nexus/db";
import { boot, loginAs, seedUser, type TestApp } from "./kit.ts";
import { PASSWORD } from "./people.ts";

/**
 * 人员与用户组测试的现场：每个用例现造三个账号并登录。给 beforeEach 里清身份表的文件用——
 * stage 沿用的跨用例登录在那种文件里会指向已删的行（2026-11-28，组可见性那组测试实弹）。
 * 账号和登录都要真算散列，一个用例三回。
 */

/** 登好的一个人：编号加能直接带上的 cookie（和 Session 差在 user 是不是整行）。 */
export interface Person {
  id: string;
  cookie: string;
}

/** 人员与用户组测试的现场：甲、乙和管理员 chief 各带一份登录，仓库根目录是 root。 */
export interface PeopleTroupe {
  api: TestApp;
  root: string;
  alice: Person;
  bob: Person;
  chief: Person;
}

type ProjectsBoot = NonNullable<Parameters<typeof boot>[0]["projects"]>;

/**
 * 每个用例现造三个账号并登录的装配：给 beforeEach 里清身份表的文件用
 * （stage 沿用的登录在那种文件里会指向已删的行）。账号和登录都要真算散列，一个用例三回。
 */
export async function stageFresh(
  db: Db,
  fresh: () => Promise<string>,
  options: ProjectsBoot = {},
): Promise<PeopleTroupe> {
  const root = await fresh();
  const api = await boot({
    db,
    projectsRoot: root,
    ...(Object.keys(options).length === 0 ? {} : { projects: options }),
  });
  return {
    api,
    root,
    alice: await person(api, db, "alice"),
    bob: await person(api, db, "bob"),
    chief: await person(api, db, "chief", true),
  };
}

/** 再装一个应用（换可替换件），沿用已有的登录：会话在库里，不在应用里。 */
export async function restageFresh(
  troupe: PeopleTroupe,
  db: Db,
  options: ProjectsBoot,
): Promise<PeopleTroupe> {
  const api = await boot({ db, projectsRoot: troupe.root, projects: options });
  return { api, root: troupe.root, alice: troupe.alice, bob: troupe.bob, chief: troupe.chief };
}

async function person(api: TestApp, db: Db, username: string, isAdmin = false): Promise<Person> {
  const user = await seedUser(db, { username, password: PASSWORD, isAdmin });
  const reply = await loginAs(api.app, username, PASSWORD);
  if (reply.status !== 200) throw new Error(`${username} 没登录上：${String(reply.status)}`);
  return { id: user.id, cookie: reply.cookie };
}
