// The system status page, through the page's own origin (charter §11 rule 4): sign in, see the
// page ask the backend, see the answer or a visible error. What signing in and out answers, and
// what the interface says without a session, is in session.spec.ts.
import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in.ts";
import { watchForMistakes } from "./watch.ts";

test("登录后，首页把后端的健康状态显示出来", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page);

  const cells = page.getByRole("region", { name: "健康状态" }).locator("dd");
  await expect(cells.nth(0)).toHaveText("正常", { timeout: 15_000 });
  await expect(cells.nth(1)).toHaveText(/^\d+\.\d+\.\d+/);
  await expect(cells.nth(2)).toHaveText("正常");

  clean();
});

test("接口出错时，页面把原因和请求号显示在卡里，别的卡照常", async ({ page }) => {
  const clean = watchForMistakes(page);
  const requestId = "0f1e2d3c-4b5a-4968-8777-66554433a211";
  // 让「启动信息」这一个接口出错。健康状态走的另一个接口，照常。
  await page.route("**/api/v1/system/info", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      headers: { "x-request-id": requestId },
      body: JSON.stringify({
        error: { code: "internal_error", message: "服务器内部错误", requestId },
      }),
    }),
  );
  await signIn(page);

  const alert = page.getByRole("region", { name: "启动信息" }).getByRole("alert");
  await expect(alert).toContainText("服务器出了问题");
  await expect(alert).toContainText(`请求号 ${requestId}`);
  await expect(page.getByRole("region", { name: "健康状态" }).locator("dd").nth(0)).toHaveText(
    "正常",
  );

  clean();
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
});
