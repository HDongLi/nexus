// End-to-end: start the real API and the real page server, then drive the page in a browser.
// 2026-11-26. Both servers belong to this run, so Playwright starts them and stops them.
//
// Keep this file free of decisions. Playwright loads it again in every worker process, so a
// port probed or a directory cleared here happens several times, with different results. The
// ports and the data directory are decided once in e2e/run.ts and arrive here by environment;
// the defaults below only apply when Playwright is started by hand.
//
// The page only ever talks to its own origin. /api reaches the backend through the dev server's
// proxy, which is the same shape as a reverse proxy standing in front of the app in production.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "@playwright/test";

const apiPort = Number(process.env.E2E_API_PORT ?? 4260);
const webPort = Number(process.env.E2E_WEB_PORT ?? apiPort + 1);
const dataDir = process.env.E2E_DATA_DIR ?? join(tmpdir(), "nexus-e2e");
const api = `http://127.0.0.1:${apiPort}`;
// Read from Vite's own manifest: its `exports` does not expose bin/, so resolving that path
// by name is refused.
const viteManifest = createRequire(import.meta.url).resolve("vite/package.json");
const vite = join(
  dirname(viteManifest),
  (JSON.parse(readFileSync(viteManifest, "utf8")) as { bin: { vite: string } }).bin.vite,
);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: { baseURL: `http://127.0.0.1:${webPort}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  // `env` replaces the environment rather than adding to it, so PATH has to come along.
  webServer: [
    {
      command: "node src/main.ts",
      cwd: join(import.meta.dirname, "..", "api"),
      url: `${api}/api/v1/system/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(apiPort),
        // The port was probed a moment ago. If it is taken anyway, fail at startup instead of
        // moving: the page's proxy would keep pointing at the port that was agreed on.
        PORT_ATTEMPTS: "1",
        LOG_LEVEL: "warn",
        DATA_DIR: dataDir,
      },
    },
    {
      command: `node "${vite}" --host 127.0.0.1 --port ${webPort} --strictPort`,
      cwd: import.meta.dirname,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...process.env, API_PROXY: api },
    },
  ],
});
