// The projects pages the way a colleague uses them (spec P-38): sign in, create one, open its
// detail, rename it, see a duplicate slug refused, and an outsider sees an empty list.
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS } from "./accounts.ts";
import { signIn } from "./sign-in.ts";
import { watchForMistakes } from "./watch.ts";

const rows = (page: Page) => page.getByRole("list", { name: "工程清单" }).locator("li");
const createButton = (page: Page) => page.getByRole("button", { name: "新建工程" }).first();
const navProjects = (page: Page) => page.getByRole("link", { name: "工程", exact: true });

/** The list rows are links to the detail; this is the row of the project created in this file. */
const createdRow = (page: Page) => rows(page).first();

// The whole suite starts from an empty database, but spec files run in parallel: the stamp keeps
// the slug unique even if a leftover database from an earlier run is still around (run.ts warns
// and carries on when it cannot clear it).
const slug = `e2e-proj-${Date.now().toString(36)}`;
const displayName = "演示工程";

// These tests build on each other (create, then look at, then rename). fullyParallel would run
// them at once, so they are pinned to run in order inside one worker.
test.describe.serial("工程页", () => {
  test("新建工程：清单第一行就是它", async ({ page }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    await page.goto("/projects");
    await expect(page.getByRole("heading", { level: 1, name: "工程" })).toBeVisible({
      timeout: 15_000,
    });

    await createButton(page).click();
    const dialog = page.getByRole("dialog", { name: "新建工程" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("短名", { exact: true }).fill(slug);
    await dialog.getByLabel("显示名", { exact: true }).fill(displayName);
    // 新建要跑几条 git（实测中位数 300–400 毫秒，机器忙时更高），等够再下结论。
    await dialog.getByRole("button", { name: "创建" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // 成功后清单立刻有它：第一行是显示名和短名，带一个像日期的创建时间。
    const row = createdRow(page);
    await expect(row).toContainText(displayName);
    await expect(row).toContainText(slug);
    await expect(row).toContainText(/\d{4}-\d{2}-\d{2}/);
    clean();
  });

  test("详情页看得到最新提交的编号和标题", async ({ page }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    await page.goto("/projects");
    await createdRow(page).click();

    await expect(page.getByRole("heading", { level: 1, name: displayName })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('dt:has-text("短名") + dd code')).toHaveText(slug);
    // 编号只显示前八位，悬停给全的：全号在里层 span 的 title 上。
    const commit = page.locator('dt:has-text("编号") + dd code span');
    await expect(commit).toHaveText(/^[0-9a-f]{8}$/);
    expect(await commit.getAttribute("title")).toHaveLength(40);
    // 初始提交的标题非空，写的是平台建仓时留的那句话。
    const subject = page.locator('dt:has-text("标题") + dd');
    await expect(subject).not.toBeEmpty();
    clean();
  });

  test("改显示名：详情和清单跟着变；清空后回落成短名", async ({ page }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    await page.goto("/projects");
    await createdRow(page).click();
    await expect(page.getByRole("heading", { level: 1, name: displayName })).toBeVisible({
      timeout: 15_000,
    });

    const rename = async (next: string): Promise<void> => {
      await page.getByRole("button", { name: "改显示名" }).click();
      const dialog = page.getByRole("dialog", { name: "改显示名" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("显示名", { exact: true }).fill(next);
      await dialog.getByRole("button", { name: "保存" }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    };

    await rename("改名工程");
    // 详情的标题跟着变，侧栏走回清单，清单里也是新名。
    await expect(page.getByRole("heading", { level: 1, name: "改名工程" })).toBeVisible();
    await navProjects(page).click();
    await expect(page.getByRole("heading", { level: 1, name: "工程" })).toBeVisible();
    await expect(createdRow(page)).toContainText("改名工程");

    // 清空就是清除：回落成短名。
    await createdRow(page).click();
    await rename("");
    await expect(page.getByRole("heading", { level: 1, name: slug })).toBeVisible();
    await navProjects(page).click();
    await expect(createdRow(page)).toContainText(slug);
    clean();
  });

  test("重名：原因常显在对话框里，清单不多一行", async ({ page }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    await page.goto("/projects");
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    const before = await rows(page).count();

    await createButton(page).click();
    const dialog = page.getByRole("dialog", { name: "新建工程" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("短名", { exact: true }).fill(slug);
    await dialog.getByLabel("显示名", { exact: true }).fill("重复的工程");
    // 回车就能提交（任务书：回车能提交）；这条顺带盖住重名的往返。
    await dialog.getByLabel("短名", { exact: true }).press("Enter");
    // 原因常显在对话框里：挨着短名那个字段，不弹浏览器原生对话框。
    await expect(dialog.getByText("短名已被占用")).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toBeVisible();
    expect(await rows(page).count()).toBe(before);
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden();
    clean();
  });
});

test("另一个非管理员账号登录后清单是空的", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page, ACCOUNTS.other);
  await page.goto("/projects");
  // 他没建过工程，也不在能看见这些工程的组里：一句引导，不是一张空表。
  await expect(page.getByText("还没有工程。新建第一个。")).toBeVisible({ timeout: 15_000 });
  await expect(rows(page)).toHaveCount(0);
  clean();
});
