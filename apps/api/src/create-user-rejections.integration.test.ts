import { createDatabase } from "@nexus/db";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { userRows } from "./testing/kit.ts";
import { PASSWORD, SPAWNING, counts, dataDirs, runCreateUser } from "./testing/create-user.ts";

const dirs = dataDirs();

afterAll(async () => {
  await dirs.removeAll();
});

/** 脚本拒绝的四件事，外加用法不对和库正被别人拿着。被拒的共同点：退出码非零、原因在标准错误、不写库。 */
describe("建账号脚本：被拒的时候（规格 I-47、I-48）", () => {
  it(
    "用户名已存在（含只差大小写）：退出码 1，原因在标准错误，库里还是一行、一条事件",
    async () => {
      const dataDir = await dirs.fresh();
      expect(
        (await runCreateUser(["--username", "alice", "--password-stdin"], `${PASSWORD}\n`, dataDir))
          .code,
      ).toBe(0);
      // 同一个库上的两次脚本只能一前一后跑
      for (const username of ["alice", "ALICE"]) {
        const run = await runCreateUser(
          ["--username", username, "--password-stdin"],
          "another-pw-99\n",
          dataDir,
        );
        expect(run.code, username).toBe(1);
        expect(run.stdout, username).toBe("");
        expect(run.stderr, username).toContain("已经存在");
        expect(run.stderr, username).not.toContain("another-pw-99");
      }
      expect(await counts(dataDir)).toEqual({ users: 1, created: 1 });
    },
    SPAWNING,
  );

  it(
    "用户名不合规、口令短于最短长度、标准输入为空：各回退出码 1，原因在标准错误，不写库",
    async () => {
      const cases: [string, string[], string | null, RegExp][] = [
        [
          "用户名不合规",
          ["--username", "bad name", "--password-stdin"],
          "long-enough-pw\n",
          /用户名不合规/,
        ],
        [
          "口令太短",
          ["--username", "dave", "--password-stdin"],
          "short-7\n",
          /口令太短.*至少 8 个字符/,
        ],
        ["标准输入为空", ["--username", "dave", "--password-stdin"], null, /标准输入是空的/],
      ];
      // 各用各的目录，同时跑
      const results = await Promise.all(
        cases.map(async ([label, args, stdin, reason]) => {
          const dataDir = await dirs.fresh();
          const run = await runCreateUser(args, stdin, dataDir);
          return { label, stdin, reason, run, written: await counts(dataDir) };
        }),
      );
      for (const { label, stdin, reason, run, written } of results) {
        expect(run.code, label).toBe(1);
        expect(run.stdout, label).toBe("");
        expect(run.stderr, label).toMatch(reason);
        // 口令不进标准错误（I-47）
        if (stdin !== null) expect(run.stderr, label).not.toContain(stdin.trim());
        expect(written, label).toEqual({ users: 0, created: 0 });
      }
    },
    SPAWNING,
  );

  it(
    "没带 --password-stdin：打印用法，退出码 2，不读标准输入，也不碰库",
    async () => {
      const dataDir = await dirs.fresh();
      const run = await runCreateUser(["--username", "alice"], `${PASSWORD}\n`, dataDir);
      expect(run.code).toBe(2);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("用法");
      expect(run.stderr).toContain("--password-stdin");
      expect(run.stderr).not.toContain(PASSWORD);
      expect(await counts(dataDir)).toEqual({ users: 0, created: 0 });
    },
    SPAWNING,
  );

  it(
    "库正被另一个进程打开：拒，说清原因和怎么办，不去动库",
    async () => {
      const dataDir = await dirs.fresh();
      expect(
        (await runCreateUser(["--username", "alice", "--password-stdin"], `${PASSWORD}\n`, dataDir))
          .code,
      ).toBe(0);
      // 这边把库拿着，相当于服务还在跑
      const holder = await createDatabase({ dataDir: join(dataDir, "pgdata") });
      try {
        const run = await runCreateUser(
          ["--username", "mallory", "--password-stdin"],
          `${PASSWORD}\n`,
          dataDir,
        );
        expect(run.code).toBe(1);
        expect(run.stdout).toBe("");
        expect(run.stderr).toContain("正被另一个进程打开");
        expect(run.stderr).toContain("先停服务再建号");
        expect(run.stderr).toContain("postmaster.pid");
        expect(await userRows(holder.db)).toHaveLength(1);
      } finally {
        await holder.close();
      }
      // 拿着的人放手之后就能建了
      const again = await runCreateUser(
        ["--username", "mallory", "--password-stdin"],
        `${PASSWORD}\n`,
        dataDir,
      );
      expect(again.code).toBe(0);
      expect(await counts(dataDir)).toEqual({ users: 2, created: 2 });
    },
    SPAWNING,
  );
});
