import { describe, expect, it } from "vitest";
import { isPublicPath, loginSearch, safeRedirectTarget } from "./auth-gate.ts";

describe("safeRedirectTarget：登录后回到哪里", () => {
  it.each([
    ["/", "/"],
    ["/projects?tab=mine#top", "/projects?tab=mine#top"],
    ["/a/b", "/a/b"],
  ] as const)("站内的相对路径原样接受：%s", (value, expected) => {
    expect(safeRedirectTarget(value)).toBe(expected);
  });

  it.each([
    ["//evil.example/phish"],
    ["///evil.example"],
    ["/\\evil.example"],
    ["https://evil.example"],
    ["javascript:alert(1)"],
    ["evil.example"],
    [""],
    ["/%2Fevil.example"],
    ["/%5Cevil.example"],
    ["/\t/evil.example"],
    ["/ok\u0000"],
    ["/%zz"],
  ])("不是站内的相对路径，回到首页：%j", (value) => {
    expect(safeRedirectTarget(value)).toBe("/");
  });

  it.each([[undefined], [null], [123], [[["/a", "/b"]]], [{ next: "/a" }]])(
    "不是字符串，回到首页：%j",
    (value) => {
      expect(safeRedirectTarget(value)).toBe("/");
    },
  );

  it.each([["/login"], ["/login?next=/"], ["/LOGIN"], ["/login/"], ["/log%69n"]])(
    "指回登录页自己的，回到首页（否则来回跳）：%s",
    (value) => {
      expect(safeRedirectTarget(value)).toBe("/");
    },
  );

  it("和登录页只差几个字的路径是正常页面", () => {
    expect(safeRedirectTarget("/login-help")).toBe("/login-help");
  });
});

describe("isPublicPath", () => {
  it.each([["/login"], ["/LOGIN"], ["/login/"], ["/log%69n"]])("%s 不要登录", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([["/"], ["/login-help"], ["/system"]])("%s 要登录", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe("loginSearch", () => {
  it("要回的是首页就不带参数", () => {
    expect(loginSearch("/")).toEqual({});
  });

  it("别的地方带上原来的地址", () => {
    expect(loginSearch("/projects?x=1")).toEqual({ next: "/projects?x=1" });
  });
});
