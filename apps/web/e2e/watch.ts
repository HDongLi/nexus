// Two things a page must never do (charter §11 rule 2): throw, or put a business message in a
// native dialog. Every page test opens one of these and calls the returned function before it ends.
//
// This file does not import the test runner. The architecture gate lets only *.spec.ts, *.test.ts
// and *.config.ts files reach development dependencies (not-to-dev-dep in
// packages/config/dependency-cruiser.mjs), and a helper next to the specs is none of those. So the
// page is described by the little this file uses, and the check throws by itself instead of
// borrowing the runner's expect: a test still goes red, with every mistake listed in the message.

/** The part of a page this file listens to. Playwright's Page has it. */
interface WatchedPage {
  on(event: "pageerror", listener: (error: Error) => void): unknown;
  on(
    event: "dialog",
    listener: (dialog: { type(): string; dismiss(): Promise<void> }) => void,
  ): unknown;
}

export function watchForMistakes(page: WatchedPage): () => void {
  const mistakes: string[] = [];
  page.on("pageerror", (error) => mistakes.push(`脚本异常：${error.message}`));
  page.on("dialog", async (dialog) => {
    mistakes.push(`原生弹窗：${dialog.type()}`);
    await dialog.dismiss();
  });
  return () => {
    if (mistakes.length > 0) {
      throw new Error(`页面不该抛异常，也不该弹浏览器原生的对话框：\n${mistakes.join("\n")}`);
    }
  };
}
