import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { buttonClass } from "./button.tsx";
import { TextInput, type TextInputProps } from "./text-input.tsx";

export interface PasswordInputProps extends Omit<
  TextInputProps,
  "type" | "trailing" | "autoComplete"
> {
  /**
   * 浏览器靠它分清两件事：「把存好的口令填进来」和「给新口令提建议」。填错了，
   * 浏览器会把新口令存成这个网站的登录口令。
   */
  autoComplete: "current-password" | "new-password";
}

/** 口令输入框：默认掩着，右端一个按钮可以看一眼自己输的是什么。 */
export function PasswordInput({ autoComplete, id, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <TextInput
      {...props}
      id={inputId}
      type={visible ? "text" : "password"}
      autoComplete={autoComplete}
      trailing={
        <button
          type="button"
          className={buttonClass({ variant: "ghost", size: "icon-sm" })}
          aria-label={visible ? "隐藏口令" : "显示口令"}
          aria-pressed={visible}
          aria-controls={inputId}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      }
    />
  );
}
