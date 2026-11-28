// The group pages the way an administrator uses them (spec G-42): create a group, add a colleague
// with one click, hand the group a project, and that colleague's project list has it; renaming
// updates the heading and the list; deleting the group takes two clicks.
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./sign-in.ts";
import { watchForMistakes } from "./watch.ts";

// The stamp keeps names unique even if a leftover database from an earlier run is still around.
const suffix = Date.now().toString(36);
const groupName = `演示组${suffix}`;
const renamedName = `改名组${suffix}`;
const memberName = `e2e_g_member_${suffix}`;
const memberPassword = "member-password-1";
const projectName = "组内演示工程";
const projectSlug = `e2e-grp-proj-${suffix}`;

const rows = (page: Page) => page.getByRole("list", { name: "用户组清单" }).locator("li");
// 空清单的引导里也有一个「新建用户组」，和页头那个并存（照工程页的样子）：取第一个。
const createButton = (page: Page) => page.getByRole("button", { name: "新建用户组" }).first();

test.describe.serial("用户组页", () => {
  test("建组、加成员、给组挂一个工程", async ({ page }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    // 造一个同事和一个工程（真接口）：加成员用、挂工程用、验可见性也用。
    const madeMember = await page.request.post("/api/v1/users", {
      data: { username: memberName, password: memberPassword },
    });
    expect(madeMember.status()).toBe(201);
    const madeProject = await page.request.post("/api/v1/projects", {
      data: { slug: projectSlug, displayName: projectName },
    });
    expect(madeProject.status()).toBe(201);

    await page.goto("/groups");
    await expect(page.getByRole("heading", { level: 1, name: "用户组" })).toBeVisible({
      timeout: 15_000,
    });
    await createButton(page).click();
    const dialog = page.getByRole("dialog", { name: "新建用户组" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("组名", { exact: true }).fill(groupName);
    await dialog.getByRole("button", { name: "创建" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(rows(page).filter({ hasText: groupName })).toBeVisible();

    // 撞了的名字挨着组名字段常显（规格 G-41）。
    await createButton(page).click();
    const duplicate = page.getByRole("dialog", { name: "新建用户组" });
    await duplicate.getByLabel("组名", { exact: true }).fill(groupName);
    await duplicate.getByRole("button", { name: "创建" }).click();
    await expect(duplicate.getByText("组名已被占用")).toBeVisible({ timeout: 15_000 });
    await duplicate.getByRole("button", { name: "取消" }).click();
    await expect(duplicate).toBeHidden();

    // 详情：加成员、挂工程，都是点一下，页面把替换后的全集提交上去（规格 G-28）。
    await rows(page).filter({ hasText: groupName }).click();
    await expect(page.getByRole("heading", { level: 1, name: groupName })).toBeVisible({
      timeout: 15_000,
    });

    const addable = page.getByRole("list", { name: "可添加的同事清单" });
    await addable
      .locator("li")
      .filter({ hasText: memberName })
      .getByRole("button", { name: "加入" })
      .click();
    const members = page.getByRole("list", { name: "组成员清单" });
    await expect(members.locator("li").filter({ hasText: memberName })).toBeVisible({
      timeout: 15_000,
    });

    const picks = page.getByRole("list", { name: "工程加选清单" });
    const projectRow = picks.locator("li").filter({ hasText: projectName });
    await projectRow.getByRole("button", { name: "加入" }).click();
    await expect(projectRow.getByRole("button", { name: "移出" })).toBeVisible({ timeout: 15_000 });
    await expect(projectRow).toContainText("组内可见");
    clean();
  });

  test("组里的同事登录后，清单里有组看得见的工程；详情页创建者是管理员", async ({
    page,
    browser,
  }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    const base = new URL(page.url()).origin;
    const memberContext = await browser.newContext({ baseURL: base });
    const memberPage = await memberContext.newPage();
    const cleanMember = watchForMistakes(memberPage);
    await signIn(memberPage, { username: memberName, password: memberPassword });
    await memberPage.goto("/projects");
    const list = memberPage.getByRole("list", { name: "工程清单" });
    await expect(list.locator("li").filter({ hasText: projectName })).toBeVisible({
      timeout: 15_000,
    });
    // 创建者显示：详情只带编号，页面去同事名录换「显示名（用户名）」（规格 G-07）。
    await list.locator("li").filter({ hasText: projectName }).click();
    await expect(memberPage.locator('dt:has-text("创建者") + dd')).toContainText("e2e_main", {
      timeout: 15_000,
    });
    cleanMember();
    await memberContext.close();
    clean();
  });

  test("改组名：详情标题跟着变", async ({ page }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    await page.goto("/groups");
    await rows(page).filter({ hasText: groupName }).click();
    await expect(page.getByRole("heading", { level: 1, name: groupName })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "改名" }).click();
    const dialog = page.getByRole("dialog", { name: "改组名" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("组名", { exact: true }).fill(renamedName);
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1, name: renamedName })).toBeVisible({
      timeout: 15_000,
    });
    clean();
  });

  test("删组要点两下才生效", async ({ page }) => {
    const clean = watchForMistakes(page);
    await signIn(page);
    await page.goto("/groups");
    await rows(page).filter({ hasText: renamedName }).click();
    await expect(page.getByRole("heading", { level: 1, name: renamedName })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "删除组" }).click();
    await expect(page.getByRole("button", { name: "再点一次确认" })).toBeVisible();
    // 第一下不生效：还停在详情页，组还在。
    await expect(page.getByRole("heading", { level: 1, name: renamedName })).toBeVisible();

    await page.getByRole("button", { name: "再点一次确认" }).click();
    await page.waitForURL((url) => url.pathname === "/groups", { timeout: 15_000 });
    await expect(rows(page).filter({ hasText: renamedName })).toHaveCount(0);
    clean();
  });
});
