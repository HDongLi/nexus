import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AUTH, call, identityEvents, loginAs, userRows } from "./testing/kit.ts";
import {
  PASSWORD,
  SPAWNING,
  counts,
  dataDirs,
  filesContaining,
  openCreated,
  runCreateUser,
} from "./testing/create-user.ts";

const dirs = dataDirs();

afterAll(async () => {
  await dirs.removeAll();
});

/** 建成的账号：脚本说建成了，库里就有，而且真的能登录。 */
describe("建账号脚本：建成的账号（规格 I-46、I-47）", () => {
  it(
    "在空库上建管理员：退出码 0，标准输出一行 created <用户名>；记一条事件；随后登录得 200，isAdmin 和参数一致",
    async () => {
      const dataDir = await dirs.fresh();
      const run = await runCreateUser(
        ["--username", "alice", "--admin", "--password-stdin"],
        `${PASSWORD}\n`,
        dataDir,
      );
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("created alice\n");
      expect(run.stderr).toBe("");
      // 参数里只有用户名和开关：口令不在命令行上，也不进任何输出（I-47）
      expect(run.argv).toEqual([
        join("src", "scripts", "create-user.ts"),
        "--username",
        "alice",
        "--admin",
        "--password-stdin",
      ]);
      expect(`${run.stdout}${run.stderr}${run.argv.join(" ")}`).not.toContain(PASSWORD);

      // 口令也没有落盘（I-47）：脚本不写日志，这里再把整个数据目录扫一遍——库文件、预写日志都算上。
      // 对照组是用户名：它在库文件里查得到，说明这一遍扫得到东西，不是空扫。
      // 要赶在打开库之前扫：打开库本身会写文件。
      expect(await filesContaining(dataDir, PASSWORD)).toEqual([]);
      expect(await filesContaining(dataDir, "alice")).not.toEqual([]);

      const { database, api } = await openCreated(dataDir);
      try {
        const events = await identityEvents(database.db, "identity.user.created");
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          source: "identity",
          subject: "alice",
          payload: { isAdmin: true, via: "cli" },
          trace_id: null,
        });
        const login = await loginAs(api.app, "alice", PASSWORD);
        expect(login.status).toBe(200);
        expect(login.body).toMatchObject({
          user: { username: "alice", displayName: "alice", isAdmin: true },
        });
        expect(await userRows(database.db)).toEqual([
          expect.objectContaining({
            username: "alice",
            display_name: "alice",
            is_admin: true,
            disabled_at: null,
          }),
        ]);
      } finally {
        await database.close();
      }
    },
    SPAWNING,
  );

  it(
    "不带 --admin：建出来的是普通账号，管理员级的接口进不去",
    async () => {
      const dataDir = await dirs.fresh();
      const run = await runCreateUser(
        ["--username", "bob", "--password-stdin"],
        `${PASSWORD}\n`,
        dataDir,
      );
      expect(run.code).toBe(0);
      expect(run.stdout).toBe("created bob\n");
      const { database, api } = await openCreated(dataDir);
      try {
        const bob = await loginAs(api.app, "bob", PASSWORD);
        expect(bob.body).toMatchObject({ user: { isAdmin: false } });
        expect((await call(api.app, AUTH.doc, { cookie: bob.cookie })).status).toBe(403);
      } finally {
        await database.close();
      }
    },
    SPAWNING,
  );

  it(
    "口令取标准输入的第一行，去掉行尾换行（含 Windows 的回车换行）；后面的行不读",
    async () => {
      const dataDir = await dirs.fresh();
      const crlf = await dirs.fresh();
      // 两个库各在各的目录，可以同时跑；同一个库上的两次脚本不能同时跑（进程内的库一次只许一个进程打开）
      const [unix, windows] = await Promise.all([
        runCreateUser(
          ["--username", "carol", "--password-stdin"],
          `${PASSWORD}\nsecond-line-ignored\n`,
          dataDir,
        ),
        runCreateUser(["--username", "carol", "--password-stdin"], `${PASSWORD}\r\n`, crlf),
      ]);
      expect(unix.code).toBe(0);
      expect(windows.code).toBe(0);
      const logins = await Promise.all(
        [dataDir, crlf].map(async (dir) => {
          const { database, api } = await openCreated(dir);
          try {
            return [
              (await loginAs(api.app, "carol", PASSWORD)).status,
              (await loginAs(api.app, "carol", "second-line-ignored")).status,
            ] as const;
          } finally {
            await database.close();
          }
        }),
      );
      for (const [first, ignored] of logins) {
        expect(first).toBe(200);
        expect(ignored).toBe(401);
      }
    },
    SPAWNING,
  );

  it(
    "口令最短长度读的是配置：PASSWORD_MIN_LENGTH=12 时，12 个字符以下的口令被拒（I-32、I-46）",
    async () => {
      const dataDir = await dirs.fresh();
      expect("short-pw").toHaveLength(8);
      const short = await runCreateUser(
        ["--username", "erin", "--password-stdin"],
        "short-pw\n",
        dataDir,
        { PASSWORD_MIN_LENGTH: "12" },
      );
      expect(short.code).toBe(1);
      expect(short.stderr).toContain("至少 12 个字符");
      expect(await counts(dataDir)).toEqual({ users: 0, created: 0 });
      const fine = await runCreateUser(
        ["--username", "erin", "--password-stdin"],
        "long-enough-pw\n",
        dataDir,
        { PASSWORD_MIN_LENGTH: "12" },
      );
      expect(fine.code).toBe(0);
    },
    SPAWNING,
  );
});
