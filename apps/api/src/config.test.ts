import { describe, expect, it } from "vitest";
import { loadConfig, parsePublicOrigin } from "./config.ts";

describe("口令最短长度（规格 I-32）", () => {
  it("缺省是 8", () => {
    expect(loadConfig({}).PASSWORD_MIN_LENGTH).toBe(8);
  });

  it("取值 1 到 128 都收", () => {
    for (const [value, expected] of [
      ["1", 1],
      ["12", 12],
      ["128", 128],
    ] as const) {
      expect(loadConfig({ PASSWORD_MIN_LENGTH: value }).PASSWORD_MIN_LENGTH, value).toBe(expected);
    }
  });

  it("越界、不是整数、不是数字：启动即失败，并点名是哪一项", () => {
    for (const value of ["0", "129", "-1", "8.5", "abc", ""]) {
      expect(() => loadConfig({ PASSWORD_MIN_LENGTH: value }), value).toThrow(
        /PASSWORD_MIN_LENGTH/,
      );
    }
  });
});

describe("对外地址（规格 I-38）", () => {
  it("不配就是没配；留空也按没配算", () => {
    expect(parsePublicOrigin(undefined)).toBeUndefined();
    expect(loadConfig({}).PUBLIC_ORIGIN).toBeUndefined();
    expect(loadConfig({ PUBLIC_ORIGIN: "" }).PUBLIC_ORIGIN).toBeUndefined();
    expect(loadConfig({ PUBLIC_ORIGIN: "  " }).PUBLIC_ORIGIN).toBeUndefined();
  });

  it("合法的收下，回规范形式", () => {
    const cases: [string, string][] = [
      ["https://nexus.example.com", "https://nexus.example.com"],
      ["http://127.0.0.1:8443", "http://127.0.0.1:8443"],
      ["https://nexus.example.com/", "https://nexus.example.com"],
      ["https://Nexus.Example.COM:443", "https://nexus.example.com"],
      ["http://example.com:80", "http://example.com"],
      ["  https://nexus.example.com  ", "https://nexus.example.com"],
    ];
    for (const [value, expected] of cases) {
      expect(parsePublicOrigin(value), value).toBe(expected);
    }
  });

  it("不是 http 或 https 的地址、带路径、带查询串、带账号：都算不合法", () => {
    const invalid = [
      "nexus.example.com",
      "ftp://nexus.example.com",
      "file:///etc/passwd",
      "https://nexus.example.com/app",
      "https://nexus.example.com/app?x=1",
      "https://nexus.example.com?x=1",
      "https://nexus.example.com#top",
      "https://user:secret@nexus.example.com",
      "https://",
      "not a url",
      "//nexus.example.com",
    ];
    for (const value of invalid) {
      expect(() => parsePublicOrigin(value), value).toThrow();
      expect(() => loadConfig({ PUBLIC_ORIGIN: value }), value).toThrow(
        /环境变量不合法：\nPUBLIC_ORIGIN: /,
      );
    }
  });
});
