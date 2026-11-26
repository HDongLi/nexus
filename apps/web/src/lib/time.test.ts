import { describe, expect, it } from "vitest";
import { formatLocalTime } from "./time.ts";

describe("formatLocalTime", () => {
  it("按本地时区拼出「年-月-日 时:分:秒」，月日时分秒都补零", () => {
    // 用本地时间构造，再经标准格式绕一圈：断言与机器所在时区无关。
    const iso = new Date(2026, 10, 5, 7, 8, 9).toISOString();
    expect(formatLocalTime(iso)).toBe("2026-11-05 07:08:09");
  });

  it("不是时间的字符串原样返回，不崩", () => {
    expect(formatLocalTime("yesterday")).toBe("yesterday");
  });
});
