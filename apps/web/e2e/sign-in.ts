// Signing in the way a person does: the login page, the two fields, the button.
import type { Page } from "@playwright/test";
import { ACCOUNTS, type Credentials } from "./accounts.ts";

export async function signIn(page: Page, account: Credentials = ACCOUNTS.main): Promise<void> {
  await page.goto("/login");
  await fillLoginForm(page, account);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  // The first load after the servers come up is the slowest: the page server is still compiling.
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
  await page.getByRole("button", { name: new RegExp(account.username) }).waitFor();
}

/** Fills the login form without submitting. */
export async function fillLoginForm(
  page: Pick<Page, "getByLabel">,
  account: Credentials,
): Promise<void> {
  await page.getByLabel("用户名").fill(account.username);
  await page.getByLabel("口令", { exact: true }).fill(account.password);
}
