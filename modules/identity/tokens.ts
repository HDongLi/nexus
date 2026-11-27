/**
 * 会话的有效期，毫秒。30 天（规格 I-22）。
 * 不是绝对的：带着有效会话的请求进来，剩余不足 15 天就续到「此刻加 30 天」，没有上限。
 * 旧票是签发起 30 天绝对过期、不顺延，天天用的人每隔 30 天被登出一次。
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 剩余不足这么多才续期。剩余还多的时候不动库、不重发（规格 I-22）。 */
export const SESSION_RENEW_AFTER_MS = 15 * 24 * 60 * 60 * 1000;

/** 令牌至少 32 字节（规格 I-18）：256 位随机数，枚举不出来。 */
const TOKEN_BYTES = 32;

/** 造一枚新令牌：32 个随机字节，编码成 43 个字符。它只出现在 cookie 里，库里不存原文。 */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return Buffer.from(bytes).toString("base64url");
}

/** 库里只存这个：令牌的 SHA-256，六十四位十六进制。库泄了也拿不到能用的 cookie（规格 I-18）。 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("hex");
}
