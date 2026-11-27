// Two things a page must never do (charter §11 rule 2): throw, or put a business message in a
// native dialog. Every page test opens one of these and calls the returned function before it ends.
//
// The check throws by itself instead of borrowing the runner's expect: a test still goes red, with
// every mistake listed in the message.
import type { Page } from "@playwright/test";

export function watchForMistakes(page: Page): () => void {
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
