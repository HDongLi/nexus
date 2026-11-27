import { describe, expect, it } from "vitest";
import { avatarLetter } from "./account-menu.tsx";

describe("avatarLetter：头像里放哪个字", () => {
  it.each([
    ["Alice", "A"],
    ["alice", "A"],
    ["e2e_alice", "E"],
    ["张伟", "伟"],
    ["张", "张"],
    ["张伟明", "明"],
    ["John 张", "张"],
    ["  Alice  ", "A"],
    ["", "?"],
  ] as const)("%j → %s", (name, expected) => {
    expect(avatarLetter(name)).toBe(expected);
  });
});
