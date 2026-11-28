// The people page the way an administrator uses it (spec G-42): create an account and the person
// can sign in; disable them and a refresh sends them back to the login page; deletion takes two
// clicks; an account that has created a project can only be disabled; the admin cannot disable
// himself; a non-admin gets a card and no request goes out.
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS } from "./accounts.ts";
import { signIn } from "./sign-in.ts";
import { watchForMistakes } from "./watch.ts";

// The whole suite starts from an empty database, but spec files run in parallel: the stamp keeps
// the names unique even if a leftover database from an earlier run is still around.
const suffix = Date.now().toString(36);
const newUserName = `e2e_p_new_${suffix}`;
const newDisplayName = "演示同事";
const personPassword = "person-password-1";
const creatorName = `e2e_p_creator_${suffix}`;
const disposableName = `e2e_p_gone_${suffix}`;
const extraPassword = "extra-password-1";

const rows = (page: Page) => page.getByRole("list", { name: "人员清单" }).locator("li");
const rowOf = (page: Page, username: string) => rows(page).filter({ hasText: username });
// 空清单的引导里也有一个「新建账号」，和页头那个并存（照工程页的样子）：取第一个。
const createButton = (page: Page) => page.getByRole("button", { name: "新建账号" }).first();

test.describe.serial("人员页", () => {
  test("管理员建号后，这个人能登录", async ({ page, browser }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    await page.goto("/people");
    await expect(page.getByRole("heading", { level: 1, name: "人员" })).toBeVisible({
      timeout: 15_000,
    });

    await createButton(page).click();
    const dialog = page.getByRole("dialog", { name: "新建账号" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("用户名", { exact: true }).fill(newUserName);
    await dialog.getByLabel("显示名", { exact: true }).fill(newDisplayName);
    await dialog.getByLabel("初始口令", { exact: true }).fill(personPassword);
    await dialog.getByRole("button", { name: "创建" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(rowOf(page, newUserName)).toContainText(newDisplayName);

    // 这个人能登录：独立的浏览器上下文，别把管理员的会话挤掉。
    const base = new URL(page.url()).origin;
    const personContext = await browser.newContext({ baseURL: base });
    const personPage = await personContext.newPage();
    const cleanPerson = watchForMistakes(personPage);
    await signIn(personPage, { username: newUserName, password: personPassword });
    await expect(personPage.getByRole("button", { name: new RegExp(newUserName) })).toBeVisible();
    cleanPerson();
    await personContext.close();
    clean();
  });

  test("停用后，这个人刷新页面回到登录页", async ({ page, browser }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    const base = new URL(page.url()).origin;
    // 这个人的会话先活着：上个用例建好还没有动过。
    const personContext = await browser.newContext({ baseURL: base });
    const personPage = await personContext.newPage();
    const cleanPerson = watchForMistakes(personPage);
    await signIn(personPage, { username: newUserName, password: personPassword });

    await page.goto("/people");
    const row = rowOf(page, newUserName);
    await row.getByRole("button", { name: "停用", exact: true }).click();
    await expect(row).toContainText("已停用");

    // 刷新：会话已被吊销，外壳把他送回登录页。
    await personPage.reload();
    await personPage.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 });
    await expect(personPage.getByRole("button", { name: "登录", exact: true })).toBeVisible();
    cleanPerson();
    await personContext.close();
    clean();
  });

  test("删号要点两下：第一下不生效，3 秒后自己复原", async ({ page }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    // 造一个一次性的账号（真接口，没建过工程，删得掉）。
    const made = await page.request.post("/api/v1/users", {
      data: { username: disposableName, password: extraPassword },
    });
    expect(made.status()).toBe(201);
    await page.goto("/people");
    const row = rowOf(page, disposableName);
    await expect(row).toBeVisible({ timeout: 15_000 });

    const remove = row.getByRole("button", { name: "删除", exact: true });
    await remove.click();
    // 第一下只是进入确认态：按钮换了字，账号还在。
    await expect(row.getByRole("button", { name: "再点一次确认" })).toBeVisible();
    await expect(row).toBeVisible();
    // 3 秒内没有第二下：按钮自己复原，账号还在。
    await expect(row.getByRole("button", { name: "删除", exact: true })).toBeVisible({
      timeout: 6_000,
    });

    // 两下连着点：第一下进入确认态，第二下真的删。
    await remove.click();
    await row.getByRole("button", { name: "再点一次确认" }).click();
    await expect(rowOf(page, disposableName)).toHaveCount(0, { timeout: 15_000 });
    clean();
  });

  test("删一个建过工程的账号：行内常显「只能停用」，「删除」换成「停用」", async ({
    page,
    browser,
  }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    // 造一个建过工程的账号：先建号，再用他自己的会话建一个工程（规格 G-21）。
    const made = await page.request.post("/api/v1/users", {
      data: { username: creatorName, password: extraPassword },
    });
    expect(made.status()).toBe(201);
    const slug = `e2e-creator-proj-${suffix}`;
    const base = new URL(page.url()).origin;
    const creatorContext = await browser.newContext({ baseURL: base });
    const login = await creatorContext.request.post("/api/v1/auth/login", {
      data: { username: creatorName, password: extraPassword },
    });
    expect(login.status()).toBe(200);
    const project = await creatorContext.request.post("/api/v1/projects", { data: { slug } });
    expect(project.status()).toBe(201);
    await creatorContext.close();

    await page.goto("/people");
    const row = rowOf(page, creatorName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await row.getByRole("button", { name: "再点一次确认" }).click();
    // 原因常显在这一行，不会自己消失；这一行的「删除」从此换成「停用」的入口（规格 G-24）。
    await expect(row.getByText("建过工程的账号只能停用")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_200);
    await expect(row.getByText("建过工程的账号只能停用")).toBeVisible();
    await expect(row.getByRole("button", { name: "删除", exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "停用", exact: true })).toBeVisible();
    clean();
  });

  test("管理员给自己点停用：护栏的话常显在那一行", async ({ page }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    await page.goto("/people");
    const row = rowOf(page, ACCOUNTS.main.username);
    await expect(row).toBeVisible({ timeout: 15_000 });

    // 此刻 main 是唯一启用的管理员：先命中「留一个管理员」的护栏（规格 G-18），话常显不消失。
    await row.getByRole("button", { name: "停用", exact: true }).click();
    await expect(row.getByText("这是最后一个管理员")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_200);
    await expect(row.getByText("这是最后一个管理员")).toBeVisible();

    // 再造一个启用的管理员（真接口）：「最后一个」的护栏挪开，打自己的那次就轮到「不能对自己」
    // 的护栏（规格 G-19）。
    const second = `e2e_p_admin_${suffix}`;
    const made = await page.request.post("/api/v1/users", {
      data: { username: second, password: extraPassword, isAdmin: true },
    });
    expect(made.status()).toBe(201);
    await row.getByRole("button", { name: "停用", exact: true }).click();
    await expect(row.getByText("不能对自己做这个")).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText("这是最后一个管理员")).toHaveCount(0);
    // 提示常显，不会自己消失；自己也没有被停用（规格 G-19、G-41）。
    await page.waitForTimeout(1_200);
    await expect(row.getByText("不能对自己做这个")).toBeVisible();
    await expect(row).not.toContainText("已停用");
    clean();
  });
});

test("非管理员打开 /people 与 /groups 被挡在外面，不发请求", async ({ page }) => {
  const clean = watchForMistakes(page);
  const asked: string[] = [];
  page.on("request", (request) => asked.push(request.url()));
  await signIn(page, ACCOUNTS.other);
  // 导航里没有这两项入口：管理员位从前端判断只看「我是谁」的 isAdmin。
  await expect(page.getByRole("link", { name: "人员" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "用户组" })).toHaveCount(0);
  await page.goto("/people");
  await expect(page.getByText("需要管理员")).toBeVisible({ timeout: 15_000 });
  await page.goto("/groups");
  await expect(page.getByText("需要管理员")).toBeVisible({ timeout: 15_000 });
  // 挡板卡不发任何管理接口的请求（规格 G-42）。
  const askedAdmin = asked.filter((url) => /\/api\/v1\/(users|groups)/.test(url));
  expect(askedAdmin).toEqual([]);
  clean();
});
