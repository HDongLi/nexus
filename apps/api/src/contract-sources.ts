import { systemContract } from "@nexus/system";
import type { ApiInfo, ContractSource } from "./contract.ts";
import { docContract } from "./http/doc-route.ts";
import { VERSION } from "./version.ts";

/** 全平台的契约由哪些模块的声明组成。加一个模块，就在这里加一行。 */
export function contractSources(): ContractSource[] {
  return [systemContract, docContract];
}

export const API_INFO: ApiInfo = { title: "nexus API", version: VERSION };
