// The repository keeps exactly two TypeScript versions, on purpose (ADR 0001, decision 2):
// `typescript@^7`, declared once at the root, does every type check in the repository; one
// private `typescript@^5` sits in packages/api-client because the contract generator still
// needs the old compiler API. Any other declaration means somebody worked around a tool by
// adding a compiler next to it.
//
//   node tools/gates/ts-versions.ts
//
// Exit code: 0 ok, 1 an unexpected declaration.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** One dependency section of a package manifest, e.g. `devDependencies`. */
type Section = Record<string, string> | undefined;

const ROOT = join(import.meta.dirname, "..", "..");
/** Where TypeScript may be declared, and which major each place is allowed to use. */
const ALLOWED: Record<string, number> = {
  "package.json": 7,
  "packages/api-client/package.json": 5,
};
const SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];

function manifestsIn(group: string): string[] {
  const dir = join(ROOT, group);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name, "package.json"))
    .filter((path) => existsSync(path));
}

const manifests = [
  join(ROOT, "package.json"),
  ...["apps", "modules", "packages"].flatMap(manifestsIn),
];

const problems: string[] = [];
for (const path of manifests) {
  const where = relative(ROOT, path).split("\\").join("/");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, Section>;
  const declared = SECTIONS.flatMap((section) => {
    const range = manifest[section]?.["typescript"];
    return range === undefined ? [] : [{ where: `${section}.typescript`, range }];
  });
  const allowed = ALLOWED[where];

  if (allowed === undefined) {
    for (const d of declared)
      problems.push(`${where} 声明了 ${d.where} ${d.range}：只有根和 packages/api-client 可以`);
    continue;
  }
  if (declared.length === 0) {
    problems.push(`${where} 应当声明 typescript ${allowed}，现在没有`);
    continue;
  }
  for (const d of declared) {
    if (Number(d.range.match(/\d+/)?.[0]) !== allowed)
      problems.push(`${where} 的 ${d.where} 是 ${d.range}，这里只许 ${allowed}`);
  }
}

if (problems.length) {
  console.log("typescript  版本声明不合规：");
  for (const line of problems) console.log(`            ${line}`);
  console.log("            规矩见 docs/adr/0001-技术栈版本复核.md 决定 2");
} else {
  console.log("typescript  根 ^7 做全仓类型检查，packages/api-client ^5 只喂契约生成器");
}
process.exitCode = problems.length ? 1 : 0;
