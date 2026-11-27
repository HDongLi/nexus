// Signing in the way a person does: the login page, the two fields, the button.
import { ACCOUNTS, type Credentials } from "./accounts.ts";

/**
 * The part of a page signing in needs. Playwright's Page has it.
 * Like watch.ts, this file does not import the test runner: the architecture gate lets only
 * *.spec.ts, *.test.ts and *.config.ts files reach development dependencies.
 */
interface SignInPage {
  goto(url: string): Promise<unknown>;
  getByLabel(text: string, options?: { exact?: boolean }): { fill(value: string): Promise<void> };
  getByRole(
    role: "button",
    options: { name: string | RegExp; exact?: boolean },
  ): { click(): Promise<void>; waitFor(options?: { timeout?: number }): Promise<void> };
  waitForURL(url: (url: URL) => boolean, options?: { timeout?: number }): Promise<void>;
}

export async function signIn(
  page: SignInPage,
  account: Credentials = ACCOUNTS.main,
): Promise<void> {
  await page.goto("/login");
  await fillLoginForm(page, account);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  // The first load after the servers come up is the slowest: the page server is still compiling.
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
  await page.getByRole("button", { name: new RegExp(account.username) }).waitFor();
}

/** Fills the login form without submitting. */
export async function fillLoginForm(
  page: Pick<SignInPage, "getByLabel">,
  account: Credentials,
): Promise<void> {
  await page.getByLabel("用户名").fill(account.username);
  await page.getByLabel("口令", { exact: true }).fill(account.password);
}
