/**
 * 显示名和组名的规则（规格 G-12、G-25，2026-11-28）。只有规则，不碰库。
 *
 * 两条都是「去掉首尾空白后」再数，长度按 Unicode 码点数：一个四字节字符（表情）算一个，不是两个
 * （人员规格「术语」的「码点」）。形状照工程规格 P-27 的同一条。
 *
 * 存下去的是去掉首尾空白之后的值：一串空白当作「没有显示名」，留着空白页面会显示一片空；
 * 「没变就不动」（规格 G-13、G-29）比的也是存下来的值。工程模块的显示名同一条
 * （modules/projects/module.md「规格没写到、实现时定下的」第一条，2026-11-27）。
 */

export const NAME_MAX_CODE_POINTS = 64;

export const DISPLAY_NAME_RULE = "显示名最长 64 个字符，不能有控制字符；留空表示不设";
export const GROUP_NAME_RULE = "组名要有一个字以上、64 个字符以下，不能有控制字符";

/**
 * 用户名的规则：字母、数字、下划线、连字符，1 到 64 个字符（规格 I-34）。
 * 定义在这个纯规则的文件里，路由声明和建号的用例校验的是同一条，不抄第二遍。
 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Unicode 的 Cc 类：C0 和 C1 控制字符。 */
const CONTROL = /\p{Cc}/u;
const codePoints = (value: string): number => Array.from(value).length;

export function normalizeDisplayName(raw: string): string {
  return raw.trim();
}

export function normalizeGroupName(raw: string): string {
  return raw.trim();
}

/** 这个显示名收不收。收的是原始输入，判的是去掉首尾空白之后的值；空串表示没有显示名（规格 G-12）。 */
export function displayNameAccepted(raw: string): boolean {
  const value = normalizeDisplayName(raw);
  return !CONTROL.test(value) && codePoints(value) <= NAME_MAX_CODE_POINTS;
}

/** 这个组名收不收。和显示名差一处：去掉空白后不能是空的（规格 G-25）。 */
export function groupNameAccepted(raw: string): boolean {
  const value = normalizeGroupName(raw);
  return value.length > 0 && !CONTROL.test(value) && codePoints(value) <= NAME_MAX_CODE_POINTS;
}
