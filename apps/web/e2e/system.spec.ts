// The skeleton's one journey: open the page, see it ask the backend, see the answer or a
// visible error. Everything goes through the page's own origin (charter §11 rule 4, in the
// shape this skeleton can do today; the real domain and cookies come with the identity module).
import { expect, test, type Page } from "@playwright/test";

/** Two things a page must never do: throw, or put a business message in a native dialog (§11 rule 2). */
function watchForMistakes(page: Page): string[] {
  const mistakes: string[] = [];
  page.on("pageerror", (error) => mistakes.push(`脚本异常：${error.message}`));
  page.on("dialog", async (dialog) => {
    mistakes.push(`原生弹窗：${dialog.type()}`);
    await dialog.dismiss();
  });
  return mistakes;
}

test("首页把后端的健康状态显示出来", async ({ page }) => {
  const mistakes = watchForMistakes(page);
  await page.goto("/");

  const cells = page.getByRole("region", { name: "健康状态" }).locator("dd");
  await expect(cells.nth(0)).toHaveText("正常", { timeout: 15_000 });
  await expect(cells.nth(1)).toHaveText(/^\d+\.\d+\.\d+/);
  await expect(cells.nth(2)).toHaveText("正常");

  expect(mistakes).toEqual([]);
});

// Rewritten when the identity module lands: then this section shows boot records instead.
test("还没有接入的能力，页面把原因和请求号显示在卡里", async ({ page }) => {
  const mistakes = watchForMistakes(page);
  await page.goto("/");

  const alert = page.getByRole("region", { name: "启动信息" }).getByRole("alert");
  await expect(alert).toContainText("需要登录");
  await expect(alert).toContainText("身份模块还没有接入");
  await expect(alert).toContainText(/请求号 [0-9a-f-]{36}/);

  expect(mistakes).toEqual([]);
});

test("接口的失败回统一的形状，带请求号", async ({ request }) => {
  const health = await request.get("/api/v1/system/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok" });
  expect(health.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

  const missing = await request.get("/api/v1/no-such-thing");
  expect(missing.status()).toBe(404);
  const body: unknown = await missing.json();
  expect(body).toMatchObject({ error: { code: "not_found" } });
  const error = (body as { error: { requestId: string } }).error;
  expect(error.requestId).toBe(missing.headers()["x-request-id"]);

  // The skeleton says so out loud instead of pretending to check a session (apps/api/src/verify.ts).
  const info = await request.get("/api/v1/system/info");
  expect(info.status()).toBe(501);
  expect(await info.json()).toMatchObject({ error: { code: "auth_not_wired" } });
});
