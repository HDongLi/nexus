// `pnpm verify`: L0, L1 and L2 in one command. "Done" means this is green (charter §10.2).
import { spawn } from "node:child_process";

for (const level of ["l0", "l1", "l2"]) {
  const code = await new Promise<number>((resolve) => {
    const child = spawn(`node tools/gates/${level}.ts`, { stdio: "inherit", shell: true });
    child.on("error", () => resolve(1));
    child.on("exit", (c) => resolve(c ?? 1));
  });
  if (code !== 0) {
    console.log(`\nverify: ${level.toUpperCase()} 不过，停在这里`);
    process.exitCode = code;
    break;
  }
}
if (!process.exitCode) console.log("\nverify: L0、L1、L2 全绿");
