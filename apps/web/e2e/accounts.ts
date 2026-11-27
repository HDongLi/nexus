// Test accounts for the end-to-end suite. The database is empty at the start of every run, so
// e2e/run.ts creates these before the API starts. Names and passwords live here only; every
// spec takes them from here.
export interface Account {
  username: string;
  password: string;
  /** Whether e2e/run.ts passes --admin. */
  admin: boolean;
}

/** What signing in needs: the two fields and nothing else. The interface rejects unknown keys. */
export type Credentials = Pick<Account, "username" | "password">;

export const ACCOUNTS = {
  /** Signing in, signing out, looking at pages. An administrator, so the marker is exercised. */
  main: { username: "e2e_main", password: "main-password-1", admin: true },
  /**
   * For the password spec alone: that spec changes its password. Nothing else may sign in with
   * it, because spec files run in parallel and only the tests inside one file run in order.
   * Not an administrator, so "no marker" is exercised too.
   */
  password: {
    username: "e2e_password",
    password: "old-password-1",
    nextPassword: "new-password-2",
    admin: false,
  },
} as const;

export const ALL_ACCOUNTS: readonly Account[] = [ACCOUNTS.main, ACCOUNTS.password];
