import pkg from "../../../package.json" with { type: "json" };

/**
 * 版本号只有一个来源：仓根的 package.json。
 * 现在恒为 0.0.0；发布流程建好后由 git tag 推导并写回（任务书 §8.2），不手工改。
 */
export const VERSION: string = pkg.version;
