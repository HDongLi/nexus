import { defineConfig } from "vitest/config";

// 单元测试（L1）：不渲染页面，只测纯函数。
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
