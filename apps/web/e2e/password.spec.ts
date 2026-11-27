// Changing your own password through the dialog (spec I-30 to I-33, I-35).
//
// These tests run in order and share one account, because the last one changes its password. If
// one fails the rest are skipped: a retry against a half-changed password would only mislead.
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS } from "./accounts.ts";
import { fillLoginForm, signIn } from "./sign-in.ts";
import { watchForMistakes } from "./watch.ts";

test.describe.configure({ mode: "serial" });

const ACCOUNT = ACCOUNTS.password;
const userButton = (page: Page) => page.getByRole("button", { name: new RegExp(ACCOUNT.username) });

async function openDialog(page: Page) {
  await signIn(page, ACCOUNT);
  await userButton(page).click();
  await page.getByRole("menuitem", { name: "修改口令" }).click();
  const dialog = page.getByRole("dialog", { name: "修改口令" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("对话框自己会走路：打开时焦点在旧口令上，Esc 关闭，焦点回到按钮", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page, ACCOUNT);
  // 不是管理员：没有标记。
  await expect(userButton(page).getByLabel("管理员")).toHaveCount(0);

  await userButton(page).click();
  await page.getByRole("menuitem", { name: "修改口令" }).click();
  const dialog = page.getByRole("dialog", { name: "修改口令" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("旧口令", { exact: true })).toBeFocused();
  await expect(dialog.getByLabel("新口令", { exact: true })).toHaveAttribute("type", "password");
  await expect(dialog.getByLabel("新口令", { exact: true })).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
  await expect(dialog.getByLabel("旧口令", { exact: true })).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  clean();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(userButton(page)).toBeFocused();
  clean();
});

test("点遮罩关闭；点在对话框里面不关闭；从里面拖到遮罩上松开也不关闭", async ({ page }) => {
  const clean = watchForMistakes(page);
  await openDialog(page);
  const dialog = page.getByRole("dialog", { name: "修改口令" });

  // 点在对话框里面：什么都不该发生。
  await dialog.getByText("修改口令", { exact: true }).click();
  await expect(dialog).toBeVisible();

  // 从对话框里按下、拖到遮罩上松开：这不算点遮罩（选文字时经常这样）。
  const title = await dialog.getByText("修改口令", { exact: true }).boundingBox();
  if (title === null) throw new Error("找不到对话框的标题");
  const width = page.viewportSize()?.width ?? 1280;
  await page.mouse.move(title.x + 4, title.y + 4);
  await page.mouse.down();
  await page.mouse.move(width - 8, 8, { steps: 6 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();

  // 真的点在遮罩上（对话框外面的右上角）。
  await page.mouse.click(width - 8, 8);
  await expect(dialog).toBeHidden();
  await expect(userButton(page)).toBeFocused();
  clean();
});

test("旧口令不对：错误贴着那个字段常显，对话框不关", async ({ page }) => {
  const clean = watchForMistakes(page);
  const dialog = await openDialog(page);
  await dialog.getByLabel("旧口令", { exact: true }).fill("not-the-old-password");
  await dialog.getByLabel("新口令", { exact: true }).fill(ACCOUNT.nextPassword);
  await dialog.getByLabel("重复新口令", { exact: true }).fill(ACCOUNT.nextPassword);
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("旧口令不对");
  await expect(dialog.getByLabel("旧口令", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  clean();
});

test("两次输入的新口令不一样：不发请求就指出来", async ({ page }) => {
  const clean = watchForMistakes(page);
  const changes: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/auth/password")) changes.push(request.url());
  });
  const dialog = await openDialog(page);
  await dialog.getByLabel("旧口令", { exact: true }).fill(ACCOUNT.password);
  await dialog.getByLabel("新口令", { exact: true }).fill(ACCOUNT.nextPassword);
  await dialog.getByLabel("重复新口令", { exact: true }).fill("something-else-entirely");
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("两次输入的新口令不一样");
  await expect(dialog.getByLabel("重复新口令", { exact: true })).toBeFocused();
  expect(changes).toEqual([]);
  clean();
});

test("改密成功：对话框关掉，提示常显，当前页面不用重新登录；之后旧口令登不进，新口令可以", async ({
  page,
}) => {
  const clean = watchForMistakes(page);
  const dialog = await openDialog(page);
  await dialog.getByLabel("旧口令", { exact: true }).fill(ACCOUNT.password);
  await dialog.getByLabel("新口令", { exact: true }).fill(ACCOUNT.nextPassword);
  await dialog.getByLabel("重复新口令", { exact: true }).fill(ACCOUNT.nextPassword);
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(dialog).toBeHidden();
  const toast = page.getByRole("status").filter({ hasText: "口令已更新" });
  await expect(toast).toContainText("其它设备上的登录已失效");
  // 没有重新登录：还在首页，侧栏还是这个人，接口也还认这个会话。
  await expect(page).toHaveURL(/\/$/);
  await expect(userButton(page)).toBeVisible();
  const me = await page.request.get("/api/v1/auth/me");
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ user: { username: ACCOUNT.username } });
  // 提示不会自己消失，要点掉。
  await page.waitForTimeout(600);
  await expect(toast).toBeVisible();
  await page.getByRole("button", { name: "关闭提示" }).click();
  await expect(toast).toBeHidden();
  clean();

  await userButton(page).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // 旧口令登不进去。
  await fillLoginForm(page, { username: ACCOUNT.username, password: ACCOUNT.password });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("用户名或口令不对");
  await expect(page).toHaveURL(/\/login$/);

  // 新口令可以。
  await fillLoginForm(page, { username: ACCOUNT.username, password: ACCOUNT.nextPassword });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(userButton(page)).toBeVisible();
  clean();
});

test("接口：带着会话、带外域 Origin 的改密得 403 csrf_origin_mismatch，口令不变", async ({
  page,
}) => {
  const clean = watchForMistakes(page);
  // 上一条用例已经把口令改掉了，现在有效的是新的那个。
  const current = ACCOUNT.nextPassword;
  const replacement = "another-password-3";
  await signIn(page, { username: ACCOUNT.username, password: current });
  const rejected = await page.request.post("/api/v1/auth/password", {
    headers: { Origin: "https://evil.example" },
    data: { currentPassword: current, newPassword: replacement },
  });
  expect(rejected.status()).toBe(403);
  expect(await rejected.json()).toMatchObject({ error: { code: "csrf_origin_mismatch" } });
  // 被拒绝的那一次没有生效：原来的口令照样能用来改密。
  const still = await page.request.post("/api/v1/auth/password", {
    data: { currentPassword: current, newPassword: replacement },
  });
  expect(still.status()).toBe(200);
  clean();
});
