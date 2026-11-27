import { describe, expect, it } from "vitest";
import { Hono, type Context } from "hono";
import type { AppEnv } from "@nexus/http-kit";
import { SESSION_COOKIE } from "@nexus/http-kit";
import { SESSION_MAX_AGE_SECONDS, sessionCookie } from "./cookies.ts";
import { requestProtocol } from "@nexus/http-kit";

const TOKEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrs_-";

/** 一张只有两条路由的小应用：一条下发 cookie，一条清除。属性照真实路由那一套。 */
const app = new Hono<AppEnv>()
  .get("/set", (c: Context<AppEnv>) => {
    sessionCookie.set(c, TOKEN);
    return c.text("ok");
  })
  .post("/clear", (c: Context<AppEnv>) => {
    sessionCookie.clear(c);
    return c.text("ok");
  });

/** 把 Set-Cookie 拆成「名字=值」和一组属性（大小写、空白都归一）。 */
function parse(header: string): { pair: string; attributes: string[] } {
  const [pair = "", ...rest] = header.split(";");
  return { pair: pair.trim(), attributes: rest.map((part) => part.trim()) };
}

async function setCookieOf(headers: Record<string, string>): Promise<string> {
  const res = await app.request("/set", { headers });
  return res.headers.get("set-cookie") ?? "";
}

describe("会话 cookie 的属性", () => {
  it("名字、值、Path、HttpOnly、SameSite、Max-Age 一项不少，不写 Domain（I-19）", async () => {
    const cookie = parse(await setCookieOf({}));
    expect(cookie.pair).toBe(`${SESSION_COOKIE}=${TOKEN}`);
    expect(cookie.attributes).toEqual([
      `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
    ]);
    expect(SESSION_MAX_AGE_SECONDS).toBe(2_592_000);
  });

  it("https 来路加 Secure；http 不加。协议看 X-Forwarded-Proto 的最后一跳（I-20）", async () => {
    const cases: [Record<string, string>, boolean][] = [
      [{}, false],
      [{ "x-forwarded-proto": "http" }, false],
      [{ "x-forwarded-proto": "https" }, true],
      [{ "x-forwarded-proto": "HTTPS" }, true],
      // 经过两台代理：前面一台写的是 https，离本进程最近的那台写的是 http
      [{ "x-forwarded-proto": "https, http" }, false],
      [{ "x-forwarded-proto": "http, https" }, true],
      [{ "x-forwarded-proto": "ftp" }, false],
    ];
    for (const [headers, secure] of cases) {
      const cookie = parse(await setCookieOf(headers));
      expect(cookie.attributes.includes("Secure"), JSON.stringify(headers)).toBe(secure);
      const context = {
        req: { header: (name: string) => headers[name] },
      } as unknown as Parameters<typeof requestProtocol>[0];
      expect(requestProtocol(context)).toBe(secure ? "https" : "http");
    }
  });

  it("清除 cookie：同名、空值、同一个 Path、Max-Age=0、过去的 Expires（I-24）", async () => {
    const res = await app.request("/clear", {
      method: "POST",
      headers: { "x-forwarded-proto": "https" },
    });
    const cookie = parse(res.headers.get("set-cookie") ?? "");
    expect(cookie.pair).toBe(`${SESSION_COOKIE}=`);
    expect(cookie.attributes.slice(0, 3)).toEqual([
      "Max-Age=0",
      "Path=/",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
    // 清除的那一枚照下发时的属性写，浏览器才认得出是同一枚
    expect(cookie.attributes).toContain("HttpOnly");
    expect(cookie.attributes).toContain("SameSite=Lax");
    expect(cookie.attributes).toContain("Secure");
    expect(cookie.attributes.some((a) => a.startsWith("Domain"))).toBe(false);
  });
});
