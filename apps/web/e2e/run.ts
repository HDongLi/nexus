// Runs the end-to-end suite: find free ports, start from an empty database, create the test
// accounts, hand over to Playwright.
// 2026-11-26. This lives outside playwright.config.ts on purpose. Playwright loads that file
// again in every worker process, so anything decided there is decided several times and can come
// out differently each time: on the first run the runner started the page on one port and the
// workers aimed the browser one port higher. Decisions made here reach every process through
// the environment, which is the one thing they all share.
//
//   pnpm --filter @nexus/web e2e
//
// Exit code: whatever Playwright returns.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_ACCOUNTS, type Account } from "./accounts.ts";
import { freePort } from "./ports.ts";

const dataDir = join(tmpdir(), "nexus-e2e");
try {
  // Every run starts from an empty database, so "migrations replay on an empty database" is part
  // of every end-to-end run.
  rmSync(dataDir, { recursive: true, force: true });
} catch (error) {
  console.warn(
    `清不掉上一次的端到端数据库 ${dataDir}：${String(error)}。多半是上一次的后端还没退出。`,
  );
}

/**
 * The database is empty, so nobody can sign in yet. Create the test accounts with the same
 * command an administrator uses (spec I-46). This has to happen before the API process starts:
 * the development database is embedded and only one process can have it open; created while the
 * service is running, the script would print "created" and the service would never know the
 * account. Same DATA_DIR as the service, so it is the same database. Nothing touches
 * apps/api/.data.
 */
function createAccount(account: Account): void {
  const created = spawnSync(
    process.execPath,
    [
      "src/scripts/create-user.ts",
      "--username",
      account.username,
      ...(account.admin ? ["--admin"] : []),
      "--password-stdin",
    ],
    {
      cwd: join(import.meta.dirname, "..", "..", "api"),
      // The password goes in on standard input: never on a command line, where it would linger.
      input: `${account.password}\n`,
      encoding: "utf8",
      env: { ...process.env, DATA_DIR: dataDir },
    },
  );
  if (created.status !== 0) {
    console.error(`建测试账号 ${account.username} 没建成（退出码 ${created.status}）：`);
    console.error(created.stderr.trim());
    process.exit(1);
  }
}
for (const account of ALL_ACCOUNTS) createAccount(account);

// The page port is probed after the API port is known, starting one above it. Probing both from
// fixed starting points can hand the same port to both: nothing listens yet while probing.
const apiPort = await freePort(4260);
const webPort = await freePort(apiPort + 1);

// Anything given on this command line goes straight to Playwright, so part of the suite can be
// run with exactly the setup of the whole run:
//   node e2e/run.ts login.spec.ts        node e2e/run.ts -g "退出"
const SAFE_WORD = /^[\w@%+=:,./-]+$/u;
const QUOTABLE = /^[^"\s`$\\]*$/u;
const forwarded = process.argv.slice(2).map((arg) => {
  if (SAFE_WORD.test(arg)) return arg;
  if (QUOTABLE.test(arg)) return `"${arg}"`;
  throw new Error(`这个参数转给 Playwright 不安全，换个写法：${arg}`);
});

const run = spawnSync(["pnpm exec playwright test", ...forwarded].join(" "), {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    E2E_API_PORT: String(apiPort),
    E2E_WEB_PORT: String(webPort),
    E2E_DATA_DIR: dataDir,
  },
});
process.exitCode = run.status ?? 1;
