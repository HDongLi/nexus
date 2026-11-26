import { defineConfig } from "vitest/config";

// 集成测试（L2）：进程内的 PGlite 加上真实的迁移，打真实的路由。仍然不需要装数据库。
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
  },
});
