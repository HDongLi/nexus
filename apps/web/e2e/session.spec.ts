// A session from sign-in to sign-out: what the page shows once you are in, what leaving does, and
// what the interface answers with and without a cookie (spec I-05, I-24, I-25, I-35, I-36, I-49).
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, type Account } from "./accounts.ts";
import { signIn } from "./sign-in.ts";
import { watchForMistakes } from "./watch.ts";

/** Just the two fields the interface accepts: it rejects unknown keys. */
const credentials = (account: Account) => ({
  username: account.username,
  password: account.password,
});

const userButton = (page: Page) =>
  page.getByRole("button", { name: new RegExp(ACCOUNTS.main.username) });

test("登录成功：回到首页，看到健康状态和启动信息，侧栏显示当前用户", async ({ page }) => {
  const clean = watchForMistakes(page);
  await signIn(page);

  await expect(page).toHaveTitle("系统状态 · nexus");
  const health = page.getByRole("region", { name: "健康状态" });
  await expect(health.locator("dd").nth(0)).toHaveText("正常", { timeout: 15_000 });
  await expect(health.locator("dd").nth(1)).toHaveText(/^\d+\.\d+\.\d+/);
  await expect(health.locator("dd").nth(2)).toHaveText("正常");

  // 启动信息是真数据了：一次启动的时间、一个编号、至少启动过一次。
  const boot = page.getByRole("region", { name: "启动信息" });
  await expect(boot.locator("dd").nth(0)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  await expect(boot.locator("dd").nth(1)).toHaveText(/^[0-9a-f-]{36}$/);
  await expect(boot.locator("dd").nth(2)).toContainText(/\d+ 次/);
  await expect(boot.getByRole("alert")).toHaveCount(0);

  // 当前用户在侧栏：管理员带标记。
  const me = userButton(page);
  await expect(me).toContainText(ACCOUNTS.main.username);
  await expect(me.getByLabel("管理员")).toBeVisible();
  clean();
});

test("退出：回到登录页；被复制走的旧 cookie 随即失效", async ({ page, playwright }) => {
  const clean = watchForMistakes(page);
  await signIn(page);
  const copied = (await page.context().cookies()).filter(
    (cookie) => cookie.name === "nexus_session",
  );
  expect(copied).toHaveLength(1);

  await userButton(page).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "登录到 nexus" })).toBeVisible();
  // 浏览器里的 cookie 没了：拿页面自己的 cookie 去问，和没登录一样。
  const after = await page.request.get("/api/v1/system/info");
  expect(after.status()).toBe(401);
  clean();

  // 服务端那一行也删了：手里还攥着退出前复制的 cookie，一样进不来。
  const origin = new URL(page.url()).origin;
  const thief = await playwright.request.newContext({
    storageState: { cookies: copied, origins: [] },
  });
  try {
    const stolen = await thief.get(`${origin}/api/v1/system/info`);
    expect(stolen.status()).toBe(401);
    expect(await stolen.json()).toMatchObject({ error: { code: "auth_required" } });
  } finally {
    await thief.dispose();
  }
});

test("接口：没登录访问要登录的接口回 401 auth_required，带着会话回 200", async ({ request }) => {
  const anonymous = await request.get("/api/v1/system/info");
  expect(anonymous.status()).toBe(401);
  const body: unknown = await anonymous.json();
  expect(body).toMatchObject({ error: { code: "auth_required", requestId: expect.any(String) } });
  expect((body as { error: { requestId: string } }).error.requestId).toBe(
    anonymous.headers()["x-request-id"],
  );

  // page.request 和页面共用 cookie：登录一次，它就带着会话。
  const signedIn = await request.post("/api/v1/auth/login", { data: credentials(ACCOUNTS.main) });
  expect(signedIn.status()).toBe(200);
  const withSession = await request.get("/api/v1/system/info");
  expect(withSession.status()).toBe(200);
  expect(await withSession.json()).toMatchObject({ boot: { bootId: expect.any(String) } });
});

test("接口：带外域 Origin 的写请求得 403 csrf_origin_mismatch", async ({ request }) => {
  const foreign = await request.post("/api/v1/auth/login", {
    headers: { Origin: "https://evil.example" },
    data: credentials(ACCOUNTS.main),
  });
  expect(foreign.status()).toBe(403);
  expect(await foreign.json()).toMatchObject({ error: { code: "csrf_origin_mismatch" } });

  // Origin 是 null 也拒绝。
  const opaque = await request.post("/api/v1/auth/login", {
    headers: { Origin: "null" },
    data: credentials(ACCOUNTS.main),
  });
  expect(opaque.status()).toBe(403);
  expect(await opaque.json()).toMatchObject({ error: { code: "csrf_origin_mismatch" } });
});

test("接口：同一个用户名连错 5 次，第 6 次得 429 auth_locked_out", async ({ request }) => {
  // 每次运行用一个没人碰过的名字。这一条跑完它会锁 15 分钟，所以别的用例都不碰它；
  // 数据目录万一没清干净（上一次的后端没退出），也不受上一次留下的锁影响。
  const username = `nobody_${Date.now().toString(36)}`;
  const attempt = () =>
    request.post("/api/v1/auth/login", { data: { username, password: "wrong-password" } });

  for (let i = 1; i <= 5; i++) {
    const wrong = await attempt();
    expect(wrong.status(), `第 ${i} 次`).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: { code: "auth_invalid_credentials" } });
  }
  const sixth = await attempt();
  expect(sixth.status()).toBe(429);
  const body = (await sixth.json()) as { error: { code: string; details?: unknown } };
  expect(body.error.code).toBe("auth_locked_out");
  const seconds = (body.error.details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  expect(seconds).toEqual(expect.any(Number));
  expect(seconds as number).toBeGreaterThanOrEqual(1);
  expect(seconds as number).toBeLessThanOrEqual(900);
});
