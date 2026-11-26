import { defineConfig } from "vitest/config";

// 单元测试（L1）：不碰数据库、不起进程，几十毫秒一条。带数据库的放在 *.integration.test.ts。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
  },
});
