// The theme switch: three states, remembered in the browser, no flash on reload, and "follow the
// system" actually follows it.
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in.ts";
import { watchForMistakes } from "./watch.ts";

const html = (page: Page) => page.locator("html");
const DARK = /\bdark\b/;

test.beforeEach(async ({ page }) => {
  // Runs before any page script. The callback of the very first animation frame runs just before
  // the first paint, so the class it sees is the class that paint shows.
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      (window as unknown as { themeAtFirstFrame?: string }).themeAtFirstFrame =
        document.documentElement.className;
    });
  });
});

async function classAtFirstFrame(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (window as unknown as { themeAtFirstFrame?: string }).themeAtFirstFrame ?? null,
  );
}

test("没存过就跟随系统；选了浅色或深色，刷新后第一帧就是那个颜色", async ({ page }) => {
  const clean = watchForMistakes(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect(html(page)).toHaveClass(DARK);
  await signIn(page);

  // 选浅色：系统是深色也不管。
  await page.getByRole("button", { name: "主题：跟随系统" }).click();
  await page.getByRole("menuitemradio", { name: "浅色" }).click();
  await expect(html(page)).not.toHaveClass(DARK);
  await page.reload();
  await expect(page.getByRole("button", { name: "主题：浅色" })).toBeVisible();
  await expect(html(page)).not.toHaveClass(DARK);
  expect(await classAtFirstFrame(page)).toBe("");

  // 选深色：系统是浅色，存下来的才是深色。第一帧就得是深色，不能先亮一下。
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "主题：浅色" }).click();
  await page.getByRole("menuitemradio", { name: "深色" }).click();
  await expect(html(page)).toHaveClass(DARK);
  await page.reload();
  await expect(page.getByRole("button", { name: "主题：深色" })).toBeVisible();
  await expect(html(page)).toHaveClass(DARK);
  expect(await classAtFirstFrame(page)).toBe("dark");
  clean();
});

test("跟随系统：系统换，页面跟着换，不用刷新", async ({ page }) => {
  const clean = watchForMistakes(page);
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page);
  await expect(html(page)).not.toHaveClass(DARK);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html(page)).toHaveClass(DARK);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html(page)).not.toHaveClass(DARK);
  clean();
});

test("主题菜单用键盘走得通：方向键打开，上下走，Esc 收起并把焦点还给按钮", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page);
  const toggle = page.getByRole("button", { name: "主题：跟随系统" });
  await toggle.focus();
  await page.keyboard.press("ArrowDown");

  const menu = page.getByRole("menu", { name: "主题" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "浅色" })).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "深色" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitemradio", { name: "跟随系统" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitemradio", { name: "浅色" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  clean();
});
