// The login gate and the login page, in the shape a colleague meets them (spec I-49): open a
// page while signed out, get sent to the login page, sign in, land where you were going.
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS } from "./accounts.ts";
import { fillLoginForm, signIn } from "./sign-in.ts";
import { watchForMistakes } from "./watch.ts";

/** The app's home: same origin as the page, path exactly "/". */
const HOME = /^https?:\/\/[^/]+\/$/;

const userButton = (page: Page) =>
  page.getByRole("button", { name: new RegExp(ACCOUNTS.main.username) });

test("没登录打开首页，被转到登录页", async ({ page }) => {
  const clean = watchForMistakes(page);
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "登录到 nexus" })).toBeVisible({
    timeout: 15_000,
  });
  // 要回的是首页，地址里就不多带参数。
  expect(new URL(page.url()).search).toBe("");
  clean();
});

test("没登录打开要去的页面：路径、参数、锚点都记着，登录后回到那里", async ({ page }) => {
  const clean = watchForMistakes(page);
  await page.goto("/no-such-page?tab=1#frag");

  await expect(page).toHaveURL(/\/login\?next=/);
  const next = new URL(page.url()).searchParams.get("next") ?? "";
  expect(next).toContain("/no-such-page?tab=1#frag");

  await fillLoginForm(page, ACCOUNTS.main);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  // 按路径等：地址栏里「登录页的 next 参数」本来就带着这串字，按整串匹配会空过。
  await expect(page).toHaveURL((url) => url.pathname === "/no-such-page", { timeout: 15_000 });

  const landed = new URL(page.url());
  expect(landed.pathname).toBe("/no-such-page");
  expect(landed.searchParams.get("tab")).toBe("1");
  expect(landed.hash).toBe("#frag");
  // 登录着的人到了一个不存在的地方：告诉他，侧栏还在，走得出去。
  await expect(page.getByRole("heading", { name: "找不到这个页面" })).toBeVisible();
  await expect(userButton(page)).toBeVisible();
  // 这不是任何一个页面：侧栏里没有哪一项显示成「当前所在」。
  await expect(page.getByRole("link", { name: "系统状态" })).not.toHaveClass(/bg-fill-strong/);
  clean();
});

test("地址里让回到别的网站、或者指回登录页自己的：一律回首页", async ({ page }) => {
  for (const next of ["https://evil.example/", "//evil.example/", "/\\evil.example", "/login"]) {
    const clean = watchForMistakes(page);
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await fillLoginForm(page, ACCOUNTS.main);
    await page.getByRole("button", { name: "登录", exact: true }).click();

    // 同一个来源、路径就是首页：没有被带去别的网站，也没有在登录页上打转。
    await expect(page).toHaveURL(HOME);
    await expect(userButton(page)).toBeVisible();
    clean();
    // 退出来，下一种地址再从没登录开始。
    await page.context().clearCookies();
  }
});

test("口令错了：原因常显在卡里，还停在登录页，没有原生弹窗", async ({ page }) => {
  const clean = watchForMistakes(page);
  await page.goto("/login");
  await fillLoginForm(page, { username: ACCOUNTS.main.username, password: "not-the-password" });
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText("用户名或口令不对");
  await expect(page).toHaveURL(/\/login$/);
  // 口令框清空，人直接重输。
  await expect(page.getByLabel("口令", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("口令", { exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
  clean();

  // 对的口令还能进。顺手把刚才那一次失败的计数清掉（登录成功会清）。
  await fillLoginForm(page, ACCOUNTS.main);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(HOME);
  clean();
});

test("在口令框里按回车就能登录", async ({ page }) => {
  const clean = watchForMistakes(page);
  await page.goto("/login");
  await fillLoginForm(page, ACCOUNTS.main);
  await page.getByLabel("口令", { exact: true }).press("Enter");

  await expect(page).toHaveURL(HOME, { timeout: 15_000 });
  await expect(userButton(page)).toBeVisible();
  clean();
});

test("什么都没填就提交：挨着字段说，不发请求", async ({ page }) => {
  const clean = watchForMistakes(page);
  const logins: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/auth/login")) logins.push(request.url());
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page.getByText("请输入用户名")).toBeVisible();
  await expect(page.getByText("请输入口令")).toBeVisible();
  await expect(page.getByLabel("用户名")).toBeFocused();
  expect(logins).toEqual([]);

  // 填上用户名，它那句就撤掉；口令还空着，口令那句还在。
  await page.getByLabel("用户名").fill(ACCOUNTS.main.username);
  await expect(page.getByText("请输入用户名")).toHaveCount(0);
  await expect(page.getByText("请输入口令")).toBeVisible();

  // 这次发出去了。接口说口令不对：卡里只有它这一句，字段下面的「请输入」不跟着留下来。
  // 口令不对的回包在这里是模拟的：真去连错会占这个账号的试错次数。
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "auth_invalid_credentials", message: "x", requestId: "req-1" },
      }),
    }),
  );
  await page.getByLabel("口令", { exact: true }).fill("typed-something");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(/用户名或口令不对/);
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByText("请输入口令")).toHaveCount(0);
  clean();
});

test("已经登录的人打开登录页，直接回首页", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page);
  await page.goto("/login");

  await expect(page).toHaveURL(HOME);
  await expect(userButton(page)).toBeVisible();
  clean();
});

test("登录后刷新，还是登录态", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page);
  await page.reload();

  await expect(page).toHaveURL(HOME);
  await expect(userButton(page)).toBeVisible();
  clean();
});
