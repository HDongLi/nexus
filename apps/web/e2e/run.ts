// Runs the end-to-end suite: find free ports, start from an empty database, hand over to Playwright.
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

// The page port is probed after the API port is known, starting one above it. Probing both from
// fixed starting points can hand the same port to both: nothing listens yet while probing.
const apiPort = await freePort(4260);
const webPort = await freePort(apiPort + 1);

const run = spawnSync("pnpm exec playwright test", {
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
