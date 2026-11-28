import { describe, expect, it } from "vitest";
import { accountTitle, findPerson, isUuid, personLabel, shortId, type Person } from "./people.ts";

const person = (patch: Partial<Person> = {}): Person => ({
  id: "9e2f6a10-0000-4000-8000-000000000001",
  username: "alice",
  displayName: "张丽",
  isAdmin: false,
  ...patch,
});

describe("accountTitle", () => {
  it("显示名空着就回落成用户名（规格 G-12）", () => {
    expect(accountTitle({ username: "alice", displayName: "张丽" })).toBe("张丽");
    expect(accountTitle({ username: "alice", displayName: "" })).toBe("alice");
  });
});

describe("isUuid", () => {
  it("认编号的形状，别的字符串不当编号", () => {
    expect(isUuid("9e2f6a10-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("9E2F6A10-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("alice")).toBe(false);
    expect(isUuid("9e2f6a10-0000-4000-8000-00000000000")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("shortId", () => {
  it("只取前八位", () => {
    expect(shortId("9e2f6a10-0000-4000-8000-000000000001")).toBe("9e2f6a10");
  });
});

describe("findPerson", () => {
  const people = [
    person(),
    person({ id: "9e2f6a10-0000-4000-8000-000000000002", username: "bob" }),
  ];

  it("按编号找；名录只列启用的，查不到就是已停用（规格 G-07、G-21）", () => {
    expect(findPerson("9e2f6a10-0000-4000-8000-000000000002", people)?.username).toBe("bob");
    expect(findPerson("9e2f6a10-0000-4000-8000-000000000003", people)).toBeUndefined();
  });
});

describe("personLabel", () => {
  it("显示名（用户名）；显示名和用户名一样时只说一遍", () => {
    expect(personLabel(person())).toBe("张丽（alice）");
    expect(personLabel(person({ displayName: "alice" }))).toBe("alice");
    expect(personLabel(person({ displayName: "" }))).toBe("alice");
  });
});
