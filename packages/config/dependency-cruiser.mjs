// Dependency direction rules: charter §5.2 and claims P3, P5. Run by `pnpm arch` and the L0 gate.
// 2026-11-26: a plain .mjs config on purpose. It needs no TypeScript compiler, so it is immune to
// the "TypeScript 7 dropped the old compiler interface" problem (ADR 0001).
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const modulesRoot = fileURLToPath(new URL("../../modules/", import.meta.url));

// One rule per module: nobody outside module X may reach X's files except index.ts.
// Reading the directory keeps the rule list honest when a module is added or removed.
const moduleNames = readdirSync(modulesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const onlyPublicInterface = moduleNames.map((name) => ({
  name: `module-${name}-only-public-interface`,
  severity: "error",
  comment: `模块 ${name} 的内部文件只许它自己用；别的模块和应用只准走 index.ts（主张 P3）。`,
  from: { pathNot: `^modules/${name}/` },
  to: { path: `^modules/${name}/(?!index\\.ts$)` },
}));

// 测试与配置文件可以引用开发依赖。端到端目录整个都是测试代码：里面的辅助文件（登录、监视、起服务）
// 名字不带 .spec，同样可以（2026-11-27 修：原先只认文件名后缀，辅助文件只好手写类型绕过去）。
const notTestOrConfig = {
  path: "^(apps|modules|packages)/",
  pathNot: "^apps/[^/]+/e2e/|\\.(test|spec|config)\\.[cm]?[jt]sx?$",
};

export default {
  forbidden: [
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "import 了一个解析不到的模块。",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "模块依赖必须无环（主张 P3）。",
      from: {},
      to: { circular: true },
    },

    // 层级方向只有一个：apps/* → modules/* → packages/*
    {
      name: "packages-reach-nothing-up",
      severity: "error",
      comment: "packages 不含业务，不许反向依赖 apps 或 modules（任务书 §5.2）。",
      from: { path: "^packages/" },
      to: { path: "^(apps|modules)/" },
    },
    {
      name: "modules-reach-no-apps",
      severity: "error",
      comment: "领域模块不知道应用的存在（任务书 §5.2）。",
      from: { path: "^modules/" },
      to: { path: "^apps/" },
    },

    // 前后端之间唯一的接缝是生成的契约包
    {
      name: "web-only-via-contract",
      severity: "error",
      comment:
        "apps/web 只认生成的契约包、共享 schema 和界面件，永远不 import 服务端和领域模块（任务书 §5.2）。",
      from: { path: "^apps/web/" },
      to: { path: "^(apps/(?!web/)|modules/)" },
    },
    {
      name: "web-no-node-builtins",
      severity: "error",
      comment:
        "随页面发出去的代码（apps/web/src）是纯静态产物，不碰 Node 内建模块。测试文件和源码目录之外的配置、端到端脚本跑在 Node 上，不在此列。",
      from: { path: "^apps/web/src/", pathNot: "[.]test[.][cm]?[jt]sx?$" },
      to: { dependencyTypes: ["core"] },
    },

    // 模块内部的层次
    {
      name: "routes-call-services-not-repo",
      severity: "error",
      comment: "routes.ts 只做解析、鉴权、调用用例，不直接碰仓储和表（任务书 §5.3）。",
      from: { path: "^modules/[^/]+/routes\\.ts$" },
      to: { path: "^modules/[^/]+/(repo|schema)\\.ts$" },
    },
    // 一个模块一条：只拦「伸进自己模块的内部」。写成一条不限模块的规则，会把别的模块走出口的
    // 合法引用也拦下——工程表对身份出口的引用是设计定下的（2026-11-28 修，T-0024）。
    ...moduleNames.map((name) => ({
      name: `module-${name}-schema-depends-on-nothing-internal`,
      severity: "error",
      comment: "表定义不依赖本模块的用例、仓储、路由和出口，免得类型链成环。",
      from: { path: `^modules/${name}/schema\\.ts$` },
      to: { path: `^modules/${name}/(repo|service|routes|index)\\.ts$` },
    })),
    {
      name: "sql-only-in-repo-and-schema",
      severity: "error",
      comment:
        "领域模块里只有 repo.ts 和 schema.ts 可以碰 ORM；别处出现 SQL 就是越界（任务书 §5.3）。",
      from: { path: "^modules/", pathNot: "/(repo|schema)\\.ts$" },
      to: { path: "drizzle-orm" },
    },

    // 开发依赖不进产品代码
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment: "产品代码不许 import 开发依赖；测试与配置文件除外。",
      from: notTestOrConfig,
      to: { dependencyTypes: ["npm-dev"] },
    },

    ...onlyPublicInterface,
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(docs|tools|\\.turbo|dist|coverage)" },
    // The parser is swc, not TypeScript. dependency-cruiser loads `typescript` from wherever it
    // is installed itself, which is the root here, and the root's TypeScript 7.0 has none of the
    // APIs it can use (7.1 will; it is not released). Without a usable parser it reads no .ts
    // file and still exits 0, which is a false green (2026-11-26, see tools/gates/arch.ts).
    // When TypeScript 7.1 is out this line and the @swc/core dependency can go.
    parser: "swc",
    tsPreCompilationDeps: true,
    // Only the compiler options are read from here (how `.ts` specifiers resolve). The root has
    // no tsconfig.json, and pointing at one that does not exist fails the whole check.
    tsConfig: { fileName: "packages/config/tsconfig.base.json" },
    // Node in this repository resolves through each package's `exports` map, so the checker does
    // the same. dependency-cruiser keeps `exportsFields` empty for compatibility with an old
    // resolver; with that default it only finds packages that have a top-level index file, and
    // every package exporting ./src/index.ts came out as "unresolvable" (2026-11-26).
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
