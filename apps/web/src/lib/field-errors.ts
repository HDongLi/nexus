/** 字段下面的一句话。没出错的字段不出现在这里，或者明写 undefined。 */
export type FieldErrors<Field extends string> = { [K in Field]?: string | undefined };

/**
 * 字段重新有内容了，撤掉它那句「请输入」：那句话说的是上一次提交时的事，
 * 人已经照着改了，它还留着就是过时的话（2026-11-27 截图：填完用户名，「请输入用户名」还在）。
 */
export function withoutErrorIfFilled<Field extends string>(
  errors: FieldErrors<Field>,
  field: Field,
  value: string,
): FieldErrors<Field> {
  if (value === "" || errors[field] === undefined) return errors;
  return { ...errors, [field]: undefined };
}
