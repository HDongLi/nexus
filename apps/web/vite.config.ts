import tailwindcss from "@tailwindcss/vite";
import tanstackRouter from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 开发时接口由开发服务器转给后端，页面与接口同源（任务书 §3.4：默认同源反代）。
// API_PROXY 和 WEB_PORT 由仓根的 tools/dev.ts 传进来：它先探端口，再同时拉起前后端。
const apiProxy = process.env.API_PROXY ?? "http://127.0.0.1:4260";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    tanstackRouter({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 4261),
    strictPort: false,
    proxy: { "/api": { target: apiProxy, changeOrigin: false } },
  },
  build: {
    // 国企桌面的浏览器内核往往比 Chrome 旧。先按较旧的内核打包，等「麒麟加国产浏览器」的
    // 冒烟做了再按实测调整（决策记录 0001）。
    target: "chrome120",
    sourcemap: false,
  },
});
