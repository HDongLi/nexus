import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_INFO, contractSources } from "../contract-sources.ts";
import { buildOpenApiDocument } from "../contract.ts";

/** 把契约文档写进前端的契约包，那边的 openapi-typescript 再据此生成类型。 */
function main(): void {
  const target = join(
    dirname(fileURLToPath(import.meta.resolve("@nexus/api-client/package.json"))),
    "openapi.json",
  );
  const doc = buildOpenApiDocument(contractSources(), API_INFO);
  writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`契约文档已写出：${target}（${Object.keys(doc.paths ?? {}).length} 条路径）`);
}

main();
