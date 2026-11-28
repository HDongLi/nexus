/**
 * 显示名和头像字的规则（规格 P-27、P-28）。
 *
 * 两条都是「去掉首尾空白后」再数，长度按 Unicode 码点数：一个四字节字符（表情）算一个，不是两个
 * （规格「术语」的「码点」）。超长不截断、直接拒：旧系统悄悄截到 40 和 2 个字符，用户填的名字和落地的
 * 不一样（2026-11-27 新决定）。空串表示「没有」，页面上回落成短名。
 *
 * 存下去的是去掉首尾空白之后的值：一串空白就是「没有显示名」，留着空白页面会显示一片空，
 * 「没变就不动」（规格 P-31）也比的是存下来的值。
 */

export const DISPLAY_NAME_MAX = 40;
export const AVATAR_MAX = 2;

export const DISPLAY_NAME_RULE = "显示名最长 40 个字符，不能有控制字符；留空表示不设";
export const AVATAR_RULE = "头像字最长 2 个字符，中间不能有空白；留空表示不设";

/** Unicode 的 Cc 类：C0 和 C1 控制字符。 */
const CONTROL = /\p{Cc}/u;
const WHITESPACE = /\s/u;
const codePoints = (value: string): number => Array.from(value).length;

export function normalizeDisplayName(raw: string): string {
  return raw.trim();
}

export function normalizeAvatar(raw: string): string {
  return raw.trim();
}

/** 这个显示名收不收。收的是原始输入，判的是去掉首尾空白之后的值。 */
export function displayNameAccepted(raw: string): boolean {
  const value = normalizeDisplayName(raw);
  return !CONTROL.test(value) && codePoints(value) <= DISPLAY_NAME_MAX;
}

/** 这个头像字收不收。判的是去掉首尾空白之后的值：里面不许再有空白，也不许有控制字符。 */
export function avatarAccepted(raw: string): boolean {
  const value = normalizeAvatar(raw);
  return !WHITESPACE.test(value) && !CONTROL.test(value) && codePoints(value) <= AVATAR_MAX;
}
