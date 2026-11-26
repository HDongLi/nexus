import { defineConfig } from "drizzle-kit";

// 表定义住在各模块的 schema.ts 里；迁移目录住在应用里，全平台一份、线性、只前进（任务书 §8.2）。
// 改了任何 schema.ts：pnpm --filter @nexus/api db:generate 生成下一条迁移，SQL 文件入库。
export default defineConfig({
  dialect: "postgresql",
  schema: ["../../modules/*/schema.ts"],
  out: "./drizzle",
  strict: true,
  verbose: true,
});
