/**
 * 登录的闸：哪些页面不要登录，没登录的人去哪里，登录以后回到哪里。
 * 整个应用只在这里认这两件事，外壳（哪些页面不画侧栏）和路由的闸（哪些页面不查登录）用的是同一份。
 */

export const LOGIN_PATH = "/login";
export const HOME_PATH = "/";

/** 不要登录就能看的页面。新增公开页在这里登记。 */
const PUBLIC_PATHS: readonly string[] = [LOGIN_PATH];

/** 比较路径之前先归一：解码、去掉末尾的斜杠、不分大小写（路由本身也不分）。 */
function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? HOME_PATH : trimmed.toLowerCase();
}

export function isPublicPath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // 不是合法的编码：照原样比。
  }
  return PUBLIC_PATHS.includes(normalize(decoded));
}

/** 带控制字符（制表、换行之类）：浏览器解析地址时会悄悄吃掉它们，剩下的可能就不是看到的那个了。 */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** 是不是站内的相对路径：以单个 / 开头。 */
function isSitePath(pathname: string): boolean {
  return /^\/[^/\\]/.test(pathname) || pathname === HOME_PATH;
}

/**
 * 登录后回到哪里。这个值来自地址栏，谁都能改，所以只认站内的相对路径。
 * 以 // 开头的（协议相对地址）、带协议的、带反斜杠和控制字符的，浏览器可能把人带到别的网站，一律回到首页。
 * 指回登录页自己的也回到首页，否则登录页和它自己来回跳。
 */
export function safeRedirectTarget(value: unknown): string {
  if (typeof value !== "string") return HOME_PATH;
  if (hasControlChars(value) || value.includes("\\")) return HOME_PATH;
  const rawPath = value.split(/[?#]/, 1)[0] ?? HOME_PATH;
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return HOME_PATH;
  }
  if (!isSitePath(rawPath) || !isSitePath(path)) return HOME_PATH;
  return isPublicPath(path) ? HOME_PATH : value;
}

/** 去登录页时地址里带什么：要回的是首页就不带，地址干净。 */
export function loginSearch(target: string): { next?: string } {
  return target === HOME_PATH ? {} : { next: target };
}
