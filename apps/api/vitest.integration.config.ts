import { defineConfig } from "vitest/config";

// 集成测试（L2）：进程内的 PGlite 加上真实的迁移，打真实的路由。仍然不需要装数据库。
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    // 集成文件有十几个，默认全并行；每个的 beforeAll 都要开一个内存库、跑一遍迁移，
    // 8 核机上并发自举会挤过 vitest 默认 10 秒的钩子预算，成片假红（2026-11-28 审查 D-01 实弹：
    // 空载强跑 2/2 红，64 条用例根本没跑）。给钩子 30 秒，用例的超时不动。
    hookTimeout: 30_000,
  },
});
