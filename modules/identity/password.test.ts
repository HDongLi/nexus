import { describe, expect, it } from "vitest";
import { USER_CREATED } from "./events.ts";
import { createIdentityContext } from "./shared.ts";
import * as lib from "argon2";
import {
  argon2PasswordHasher,
  createArgon2Hasher,
  DECOY_HASH,
  PASSWORD_HASH_OPTIONS,
  type Argon2,
} from "./password.ts";
import { hashToken, newSessionToken } from "./tokens.ts";

const PREFIX = "$argon2id$v=19$m=19456,t=2,p=1$";

describe("口令散列", () => {
  it("存下的串以约定的前缀开头，参数是最低一档，库自己验得过（I-06）", async () => {
    const stored = await argon2PasswordHasher.hash("correct horse battery staple");
    expect(stored.startsWith(PREFIX)).toBe(true);
    expect(PASSWORD_HASH_OPTIONS).toEqual({
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      type: 2,
    });
    expect(await argon2PasswordHasher.verify(stored, "correct horse battery staple")).toBe(true);
    expect(await argon2PasswordHasher.verify(stored, "wrong horse")).toBe(false);
  });

  it("盐在串里：同一个口令两次散列的串不同，两次都验得过", async () => {
    const first = await argon2PasswordHasher.hash("same-password");
    const second = await argon2PasswordHasher.hash("same-password");
    expect(first).not.toBe(second);
    expect(await argon2PasswordHasher.verify(first, "same-password")).toBe(true);
    expect(await argon2PasswordHasher.verify(second, "same-password")).toBe(true);
  });

  it("存的不是 argon2id 格式（比如旧系统的 64 位十六进制串）：按口令不对处理，不报错（I-08）", async () => {
    const legacy = "0123456789abcdef".repeat(4);
    await expect(argon2PasswordHasher.verify(legacy, "any-password")).resolves.toBe(false);
    await expect(argon2PasswordHasher.verify("", "any-password")).resolves.toBe(false);
    await expect(
      argon2PasswordHasher.verify("$argon2i$v=19$m=65536,t=2,p=1$AAAA$AAAA", "any-password"),
    ).resolves.toBe(false);
  });

  it("账号没有口令（散列是空的）：同样按口令不对处理（I-10）", async () => {
    await expect(argon2PasswordHasher.verify(null, "any-password")).resolves.toBe(false);
    await expect(argon2PasswordHasher.verify(undefined, "any-password")).resolves.toBe(false);
  });

  it("底下的库恰好被调用一次，交的都是同一组参数：用户名不存在、没有口令、格式不对、口令不对、口令对（I-11）", async () => {
    const calls: [string, string][] = [];
    const counting: Argon2 = {
      hash: async (password, options) => {
        calls.push(["hash", JSON.stringify(options)]);
        return lib.hash(password, options);
      },
      verify: async (digest, password) => {
        calls.push([digest === DECOY_HASH ? "decoy" : "stored", password]);
        return lib.verify(digest, password);
      },
    };
    const hasher = createArgon2Hasher(counting);
    const stored = await hasher.hash("the-password");
    expect(calls).toEqual([["hash", JSON.stringify(PASSWORD_HASH_OPTIONS)]]);

    const cases: [string | null | undefined, string, string][] = [
      [undefined, "the-password", "decoy"],
      [null, "the-password", "decoy"],
      ["", "the-password", "decoy"],
      ["0123456789abcdef".repeat(4), "the-password", "decoy"],
      [stored, "wrong-password", "stored"],
      [stored, "the-password", "stored"],
    ];
    const answers: boolean[] = [];
    for (const [digest, password, via] of cases) {
      const before = calls.length;
      answers.push(await hasher.verify(digest, password));
      expect(calls.slice(before), JSON.stringify([digest, password])).toEqual([[via, password]]);
    }
    expect(answers).toEqual([false, false, false, false, false, true]);
    // 假散列交下去的参数和真散列一模一样：对假散列的那一次校验和「口令不对」花一样的时间
    expect(DECOY_HASH.split("$").slice(0, 4)).toEqual(stored.split("$").slice(0, 4));
  });

  it("假散列是一份合规格式、同一组参数的 argon2id 散列，对任何口令都验不过（I-11）", async () => {
    expect(DECOY_HASH).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(await argon2PasswordHasher.verify(DECOY_HASH, "any-password")).toBe(false);
  });
});

describe("会话令牌", () => {
  it("令牌是 43 个字符的 URL 安全随机串，每次都不一样（I-18）", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newSessionToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(token).not.toContain("=");
    }
  });

  it("库里存的是令牌的 SHA-256，六十四位小写十六进制；散列里看不出令牌（I-18）", async () => {
    const token = newSessionToken();
    const digest = await hashToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // 和 node:crypto 算出来的对一遍
    const { createHash } = await import("node:crypto");
    expect(digest).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(await hashToken(`${token}x`)).not.toBe(digest);
  });
});

describe("发事件之前先过形状", () => {
  it("payload 多一个键就抛，不交给事件日志（I-40）", async () => {
    const written: unknown[] = [];
    const ctx = createIdentityContext({
      db: {} as never,
      repo: {} as never,
      passwordMinLength: 8,
      eventLog: {
        emit: async (input) => {
          written.push(input);
          return {
            id: 1,
            type: input.type,
            source: input.source,
            payload: input.payload,
            occurredAt: "",
          };
        },
      },
    });
    const id = "10000000-0000-4000-8000-000000000001";
    // 多一个键
    await expect(
      ctx.emit(
        undefined,
        USER_CREATED,
        "alice",
        { userId: id, isAdmin: false, via: "cli", password: "x" },
        undefined,
      ),
    ).rejects.toThrow(/不合形状/);
    // 少一个键、值不对
    await expect(
      ctx.emit(undefined, USER_CREATED, "alice", { userId: id, isAdmin: false }, undefined),
    ).rejects.toThrow(/不合形状/);
    await expect(
      ctx.emit(
        undefined,
        USER_CREATED,
        "alice",
        { userId: id, isAdmin: false, via: "web" },
        undefined,
      ),
    ).rejects.toThrow(/不合形状/);
    expect(written).toEqual([]);
    await expect(
      ctx.emit(
        undefined,
        USER_CREATED,
        "alice",
        { userId: id, isAdmin: false, via: "cli" },
        undefined,
      ),
    ).resolves.toBeDefined();
    expect(written).toHaveLength(1);
  });
});
