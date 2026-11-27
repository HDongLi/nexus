import { describe, expect, it } from "vitest";
import { withoutErrorIfFilled, type FieldErrors } from "./field-errors.ts";

type Form = FieldErrors<"username" | "password">;

describe("withoutErrorIfFilled：字段有内容了就撤掉它那句「请输入」", () => {
  it("两个都空着提交过：填上用户名，只撤用户名那句", () => {
    const errors: Form = { username: "请输入用户名", password: "请输入口令" };
    expect(withoutErrorIfFilled(errors, "username", "alice")).toEqual({
      username: undefined,
      password: "请输入口令",
    });
  });

  it("还是空的就不撤", () => {
    const errors: Form = { username: "请输入用户名", password: undefined };
    expect(withoutErrorIfFilled(errors, "username", "")).toBe(errors);
  });

  it("这个字段本来就没有错：原样交回，不另造一份（界面不用重画）", () => {
    const errors: Form = { username: undefined, password: "请输入口令" };
    expect(withoutErrorIfFilled(errors, "username", "alice")).toBe(errors);
  });

  it("口令里打了一个空格也算有内容：口令不裁空白，交给提交时的检查", () => {
    const errors: Form = { username: undefined, password: "请输入口令" };
    expect(withoutErrorIfFilled(errors, "password", " ").password).toBeUndefined();
  });
});
