import { describe, expect, it } from "vitest";
import { avatarOf, displayNameOf, isProjectId, shortCommit } from "./projects.ts";

const project = {
  id: "5f0a1c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  slug: "demo-app",
  displayName: "演示工程",
  avatar: "演",
  createdById: "1a2b3c4d-5e6f-4a5b-8c9d-0e1f2a3b4c5d",
  createdAt: "2026-11-28T10:00:00Z",
  updatedAt: "2026-11-28T10:00:00Z",
};

describe("显示名与头像字的回落（规格 P-30）", () => {
  it("显示名在就用显示名", () => {
    expect(displayNameOf(project)).toBe("演示工程");
  });

  it("显示名空着回落成短名", () => {
    expect(displayNameOf({ ...project, displayName: "" })).toBe("demo-app");
  });

  it("头像字在就用头像字，两个字符也原样", () => {
    expect(avatarOf(project)).toBe("演");
    expect(avatarOf({ ...project, avatar: "演示" })).toBe("演示");
  });

  it("头像字空着回落成显示内容的首个字符，四字节字符算一个", () => {
    expect(avatarOf({ ...project, avatar: "" })).toBe("演");
    expect(avatarOf({ ...project, avatar: "", displayName: "" })).toBe("d");
    expect(avatarOf({ ...project, avatar: "", displayName: "🛰️站" })).toBe("🛰");
  });

  it("什么显示内容都不剩，头像字给问号", () => {
    expect(avatarOf({ ...project, avatar: "", displayName: "" })).toBe("d");
  });
});

describe("提交编号与工程编号", () => {
  it("提交编号只取前八位", () => {
    expect(shortCommit("0123456789abcdef")).toBe("01234567");
    expect(shortCommit("abc")).toBe("abc");
  });

  it("工程编号认大小写两种 UUID 形状", () => {
    expect(isProjectId(project.id.toUpperCase())).toBe(true);
    expect(isProjectId(project.id)).toBe(true);
  });

  it("不是 UUID 的地址不当成工程：短名、空串、带了多余的东西都不行", () => {
    for (const bad of ["demo-app", "", `${project.id}-extra`, "5f0a1c2e-3b4d-4e5f-8a9b"]) {
      expect(isProjectId(bad)).toBe(false);
    }
  });
});
