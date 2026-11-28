import { describe, expect, it } from "vitest";
import {
  displayNameAccepted,
  groupNameAccepted,
  normalizeDisplayName,
  normalizeGroupName,
} from "./names.ts";

/**
 * 显示名和组名的规则，表驱动（规格 G-12、G-25 的验收：单元测试表驱动）。
 * 长度按 Unicode 码点数：一个四字节字符算一个（人员规格「术语」）。
 */

describe("显示名的规则（规格 G-12）", () => {
  it("空串、64 个汉字、首尾带空白、四字节字符：收；65 个码点、控制字符：不收", () => {
    for (const name of [
      "",
      "汉".repeat(64),
      "  甲乙  ",
      "😀", // 四字节字符，一个码点
      "a".repeat(64),
    ]) {
      expect(displayNameAccepted(name), name.slice(0, 8)).toBe(true);
    }
    for (const name of ["a".repeat(65), "汉".repeat(65), "带\n换行的名字", "带\r回车的名字"]) {
      expect(displayNameAccepted(name), JSON.stringify(name).slice(0, 12)).toBe(false);
    }
    // 首尾空白先去掉再判：开头一个制表符去掉之后就不剩控制字符，收
    expect(displayNameAccepted("\t制表符开头")).toBe(true);
  });

  it("存下去的是去掉首尾空白之后的值", () => {
    expect(normalizeDisplayName("  甲乙  ")).toBe("甲乙");
    expect(normalizeDisplayName("甲乙")).toBe("甲乙");
  });
});

describe("组名的规则（规格 G-25）", () => {
  it("一个汉字、64 个字符：收；空串、一串空白、65 个字符、含换行：不收", () => {
    for (const name of ["组", "a".repeat(64), "汉".repeat(64), "  开发组  "]) {
      expect(groupNameAccepted(name), name.slice(0, 8)).toBe(true);
    }
    for (const name of ["", "   ", "a".repeat(65), "汉".repeat(65), "带\n换行的组名"]) {
      expect(groupNameAccepted(name), JSON.stringify(name).slice(0, 12)).toBe(false);
    }
  });

  it("存下去的是去掉首尾空白之后的值；大小写按原样留", () => {
    expect(normalizeGroupName("  DevOps  ")).toBe("DevOps");
    expect(normalizeGroupName("dev")).toBe("dev");
  });
});
