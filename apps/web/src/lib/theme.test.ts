import { THEME_STORAGE_KEY, parsePreference, resolveTheme } from "@nexus/ui-kit";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/** index.html 里那段在第一次绘制之前就给 <html> 加上 dark 类的内联脚本。 */
const found = /<script>([\s\S]*?)<\/script>/.exec(
  readFileSync(new URL("../../index.html", import.meta.url), "utf8"),
)?.[1];

if (found === undefined) throw new Error("apps/web/index.html 里找不到内联脚本");
const inlineScript: string = found;

/** 在一个假的浏览器里跑那段脚本，回它给 <html> 加了哪些类。 */
function runInlineScript(stored: string | null | "throws", systemDark: boolean): string[] {
  const added: string[] = [];
  runInNewContext(inlineScript, {
    localStorage: {
      getItem: (key: string): string | null => {
        if (stored === "throws") throw new Error("SecurityError");
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    },
    window: { matchMedia: () => ({ matches: systemDark }) },
    document: { documentElement: { classList: { add: (name: string) => added.push(name) } } },
  });
  return added;
}

describe("主题的三态", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    [null, "system"],
    ["", "system"],
    ["neon", "system"],
  ] as const)("存的是 %s，算作 %s", (raw, expected) => {
    expect(parsePreference(raw)).toBe(expected);
  });

  it.each([
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["dark", true, "dark"],
    ["system", false, "light"],
    ["system", true, "dark"],
  ] as const)("%s + 系统深色=%s → %s", (preference, systemDark, expected) => {
    expect(resolveTheme(preference, systemDark)).toBe(expected);
  });
});

describe("index.html 的内联脚本", () => {
  it("读的就是 ThemeProvider 写的那个键，否则刷新后会先闪一下", () => {
    expect(inlineScript).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
  });

  // 两种存法 × 两种系统配色，再加存坏了的、读不到存储的：脚本定的和 React 接手后定的必须一样。
  it.each([
    ["light", false],
    ["light", true],
    ["dark", false],
    ["dark", true],
    ["system", false],
    ["system", true],
    [null, false],
    [null, true],
    ["neon", false],
    ["neon", true],
    ["throws", false],
    ["throws", true],
  ] as const)("存的是 %s、系统深色=%s：和 resolveTheme 判断一致", (stored, systemDark) => {
    const added = runInlineScript(stored, systemDark);
    const preference = stored === "throws" ? "system" : parsePreference(stored);
    expect(added).toEqual(resolveTheme(preference, systemDark) === "dark" ? ["dark"] : []);
  });
});
