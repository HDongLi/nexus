// The shell around the pages: the sidebar, the account menu by keyboard, the drawer on narrow
// windows (decision record 0004: usable below 768 pixels).
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS } from "./accounts.ts";
import { signIn } from "./sign-in.ts";
import { watchForMistakes } from "./watch.ts";

// Both the page's button and the drawer's backdrop are called "收起导航" when the drawer is open,
// which is right for a person. Tests tell them apart by what they are.
const backdrop = (page: Page) => page.locator('button[aria-label="收起导航"]:not([aria-expanded])');
const navToggle = (page: Page) => page.locator("header button[aria-expanded]");
const userButton = (page: Page) =>
  page.getByRole("button", { name: new RegExp(ACCOUNTS.main.username) });
const sidebar = (page: Page) => page.getByRole("navigation", { name: "主导航" });

/** Nothing sticks out sideways: not the window, not the area the page scrolls in. */
async function expectFitsHorizontally(page: Page): Promise<void> {
  const fits = await page.evaluate(() => {
    const scroller = document.querySelector("div.overflow-y-auto");
    return {
      window: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      content: scroller === null || scroller.scrollWidth <= scroller.clientWidth,
    };
  });
  expect(fits.window, "整页不该横向滚动").toBe(true);
  expect(fits.content, "内容区不该横向滚动").toBe(true);
}

test.use({ viewport: { width: 430, height: 860 } });

test("430 像素宽的登录页放得下", async ({ page }) => {
  const clean = watchForMistakes(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "登录到 nexus" })).toBeVisible({
    timeout: 15_000,
  });
  const card = page.locator("form").locator("xpath=..");
  const box = await card.boundingBox();
  if (box === null) throw new Error("找不到登录卡");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(430);
  await expectFitsHorizontally(page);
  clean();
});

test("430 像素宽：导航收进抽屉，拉得开、关得上，关上后焦点回到按钮", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page);
  const aside = page.locator("aside");

  // 收着的时候整个抽屉在窗口左边的外面。
  await expect(navToggle(page)).toHaveAccessibleName("展开导航");
  expect((await aside.boundingBox())?.x ?? 0).toBeLessThan(0);
  await expectFitsHorizontally(page);

  await navToggle(page).click();
  await expect(backdrop(page)).toBeVisible();
  await expect(sidebar(page)).toBeInViewport({ ratio: 1 });
  await expect(navToggle(page)).toHaveAccessibleName("收起导航");

  // 点遮罩关上。
  await backdrop(page).click({ position: { x: 400, y: 400 } });
  await expect(backdrop(page)).toHaveCount(0);
  expect((await aside.boundingBox())?.x ?? 0).toBeLessThan(0);

  // Esc 也关得上，焦点回到拉开它的按钮。
  await navToggle(page).click();
  await expect(backdrop(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(backdrop(page)).toHaveCount(0);
  await expect(navToggle(page)).toBeFocused();
  clean();
});

test("抽屉里点主题和账号按钮抽屉不收；Esc 只收菜单；点导航项抽屉收起", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page);
  await navToggle(page).click();
  await expect(backdrop(page)).toBeVisible();

  await page.getByRole("button", { name: "主题：跟随系统" }).click();
  const theme = page.getByRole("menu", { name: "主题" });
  await expect(theme).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(theme).toBeHidden();
  // 抽屉没动。
  await expect(backdrop(page)).toBeVisible();
  await expect(sidebar(page)).toBeInViewport({ ratio: 1 });

  await userButton(page).click();
  const account = page.getByRole("menu", { name: "账号菜单" });
  await expect(account).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(account).toBeHidden();
  await expect(userButton(page)).toBeFocused();
  await expect(sidebar(page)).toBeInViewport({ ratio: 1 });

  await page.getByRole("link", { name: "系统状态" }).click();
  await expect(backdrop(page)).toHaveCount(0);
  clean();
});

test("抽屉开着时按 Esc 关掉改密对话框，抽屉不跟着关", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page);
  await navToggle(page).click();
  await userButton(page).click();
  await page.getByRole("menuitem", { name: "修改口令" }).click();
  const dialog = page.getByRole("dialog", { name: "修改口令" });
  await expect(dialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(userButton(page)).toBeFocused();
  await expect(sidebar(page)).toBeInViewport({ ratio: 1 });
  await expectFitsHorizontally(page);
  clean();
});

test("焦点在抽屉里时收起抽屉，焦点回到页头上拉开它的按钮", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page);
  await navToggle(page).click();

  // 焦点落在抽屉里的主题按钮上，按 Esc 收抽屉。
  await page.getByRole("button", { name: "主题：跟随系统" }).focus();
  await page.keyboard.press("Escape");
  await expect(backdrop(page)).toHaveCount(0);
  await expect(navToggle(page)).toBeFocused();

  // 先关对话框再关抽屉也是一样：两步之后焦点落回页头。
  await navToggle(page).click();
  await userButton(page).click();
  await page.getByRole("menuitem", { name: "修改口令" }).click();
  await page.keyboard.press("Escape");
  await expect(userButton(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(backdrop(page)).toHaveCount(0);
  await expect(navToggle(page)).toBeFocused();
  clean();
});

test("用户菜单用键盘走得通，关上后焦点回到按钮", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page);
  const me = userButton(page);
  await me.focus();
  await page.keyboard.press("ArrowUp");

  const menu = page.getByRole("menu", { name: "账号菜单" });
  await expect(menu).toBeVisible();
  await expect(me).toHaveAttribute("aria-expanded", "true");
  await expect(me).toHaveAttribute("aria-haspopup", "menu");
  // 是谁、是不是管理员，按钮上已经写了；菜单里只有两件事。
  await expect(me).toContainText(ACCOUNTS.main.username);
  await expect(me.getByLabel("管理员")).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["修改口令", "退出登录"]);
  // 向上打开落在最后一项。
  await expect(menu.getByRole("menuitem", { name: "退出登录" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "修改口令" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "退出登录" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(me).toBeFocused();
  await expect(me).toHaveAttribute("aria-expanded", "false");
  clean();
});

// 桌面宽度：侧栏一直在，当前用户按钮直接点得到。
test.describe("桌面宽度", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("点页面别处，菜单收起；点菜单里的一项，菜单先收起再去做事", async ({ page }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    await expect(page.getByRole("button", { name: "展开导航" })).toBeHidden();
    await userButton(page).click();
    await expect(page.getByRole("menu", { name: "账号菜单" })).toBeVisible();

    await page.getByRole("heading", { level: 1, name: "系统状态" }).click();
    await expect(page.getByRole("menu", { name: "账号菜单" })).toBeHidden();

    await userButton(page).click();
    await page.getByRole("menuitem", { name: "修改口令" }).click();
    await expect(page.getByRole("menu", { name: "账号菜单" })).toBeHidden();
    await expect(page.getByRole("dialog", { name: "修改口令" })).toBeVisible();
    // 窄屏抽屉的遮罩不该在桌面上出现。
    await expect(backdrop(page)).toHaveCount(0);
    clean();
  });
});
