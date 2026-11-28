import { describe, expect, it } from "vitest";
import {
  avatarAccepted,
  displayNameAccepted,
  normalizeAvatar,
  normalizeDisplayName,
} from "./names.ts";
import { createProjectRequest, updateProjectRequest } from "./routes.ts";
import { SLUG_PATTERN } from "./slug.ts";

const accepted = (rule: (raw: string) => boolean, valid: string[], invalid: string[]) => {
  for (const raw of valid) expect(rule(raw), JSON.stringify(raw)).toBe(true);
  for (const raw of invalid) expect(rule(raw), JSON.stringify(raw)).toBe(false);
};

describe("短名的规则，表驱动（规格 P-13）", () => {
  it("一个字符、64 个字符通过；大写字母、下划线、65 个字符、空串、首尾空白都不通过", () => {
    accepted(
      SLUG_PATTERN.test.bind(SLUG_PATTERN),
      ["a", "7", `a${"-".repeat(62)}z`],
      [
        "Alpha",
        "A",
        "a_b",
        "a".repeat(65),
        "",
        " alpha",
        "alpha ",
        "\talpha",
        "-alpha",
        "alpha/beta",
        "有",
      ],
    );
  });

  it("按原样收：请求里带的短名就是落到记录上的短名，不去空白也不改大小写", () => {
    expect(createProjectRequest.safeParse({ slug: " alpha" }).success).toBe(false);
    expect(createProjectRequest.safeParse({ slug: "Alpha" }).success).toBe(false);
    expect(createProjectRequest.parse({ slug: "a-b-9" }).slug).toBe("a-b-9");
  });
});

describe("显示名的规则，表驱动（规格 P-27）", () => {
  it("空串、40 个汉字、首尾带空白通过；41 个字符、含换行、含制表符不通过", () => {
    accepted(
      displayNameAccepted,
      ["", "有".repeat(40), "  名字  ", "a".repeat(40), "😀".repeat(40)],
      ["a".repeat(41), "有".repeat(41), "a\nb", "a\tb", "a\u0000b", "a\u007fb", "😀".repeat(41)],
    );
  });

  it("长度按码点数：40 个四字节字符通过，41 个不通过", () => {
    expect(Array.from("😀".repeat(40)).length).toBe(40);
    expect(displayNameAccepted("😀".repeat(40))).toBe(true);
    expect(displayNameAccepted("😀".repeat(41))).toBe(false);
  });

  it("存下去的是去掉首尾空白之后的值；一串空白就是没有显示名", () => {
    expect(normalizeDisplayName("  名字  ")).toBe("名字");
    expect(normalizeDisplayName("   ")).toBe("");
  });

  it("新建和改用的是同一条规则", () => {
    for (const parse of [
      (body: Record<string, unknown>) => createProjectRequest.safeParse({ slug: "a", ...body }),
      (body: Record<string, unknown>) => updateProjectRequest.safeParse(body),
    ]) {
      expect(parse({ displayName: "有".repeat(40) }).success).toBe(true);
      expect(parse({ displayName: "有".repeat(41) }).success).toBe(false);
      expect(parse({ displayName: "a\nb" }).success).toBe(false);
    }
  });
});

describe("头像字的规则，表驱动（规格 P-28）", () => {
  it("一个四字节字符、两个汉字通过；三个字符、中间带空格不通过", () => {
    accepted(
      avatarAccepted,
      ["", "😀", "汉字", "AB", " 字 ", "9"],
      ["abc", "A B", "a\tb", "有 有", "😀😀😀", "a\nb", "a\u0000b"],
    );
  });

  it("长度按码点数：一个四字节字符是一个，不是两个", () => {
    expect("😀".length).toBe(2);
    expect(avatarAccepted("😀😀")).toBe(true);
    expect(avatarAccepted("😀😀😀")).toBe(false);
  });

  it("存下去的是去掉首尾空白之后的值", () => {
    expect(normalizeAvatar(" 字 ")).toBe("字");
    expect(normalizeAvatar("  ")).toBe("");
  });

  it("新建和改用的是同一条规则", () => {
    for (const parse of [
      (body: Record<string, unknown>) => createProjectRequest.safeParse({ slug: "a", ...body }),
      (body: Record<string, unknown>) => updateProjectRequest.safeParse(body),
    ]) {
      expect(parse({ avatar: "汉字" }).success).toBe(true);
      expect(parse({ avatar: "有 有" }).success).toBe(false);
      expect(parse({ avatar: "abc" }).success).toBe(false);
    }
  });
});

describe("请求体的形状（规格 P-02、P-32）", () => {
  it("新建：短名必填，显示名和头像字可省；没声明的键不收", () => {
    expect(createProjectRequest.safeParse({ slug: "a" }).success).toBe(true);
    expect(
      createProjectRequest.safeParse({ slug: "a", displayName: "甲", avatar: "甲" }).success,
    ).toBe(true);
    for (const body of [
      {},
      { displayName: "没有短名" },
      { slug: 123 },
      { slug: "a", extra: 1 },
      { slug: "a", id: "30000000-0000-4000-8000-000000000001" },
    ]) {
      expect(createProjectRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("改：显示名和头像字至少带一个；带 slug 一律不收", () => {
    expect(updateProjectRequest.safeParse({ displayName: "甲" }).success).toBe(true);
    expect(updateProjectRequest.safeParse({ avatar: "" }).success).toBe(true);
    for (const body of [{}, { slug: "a" }, { slug: "a", displayName: "甲" }, { displayName: 1 }]) {
      expect(updateProjectRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
