import { argon2id, hash, verify } from "argon2";

/**
 * argon2id 的参数（规格 I-06）：内存 19456 KiB、迭代 2 次、并行 1，是公开推荐的最低一档。
 * 库的缺省值重四倍（m=65536、t=3、p=4）；2026-11-27 本机实测，这一档一次约 24 毫秒，缺省档约 48 毫秒。
 * 写死在这一处，不做成配置：参数一变，所有已存的散列都要重算，而且登录要按哪一组参数验也说不清了。
 */
export const PASSWORD_HASH_OPTIONS = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * 一份固定的假散列。用户名不存在、账号没有口令、存的不是 argon2id 格式时，拿它把校验做完再回「不对」
 * （规格 I-08、I-11）：三种情形和「口令不对」花一样的时间，从响应快慢上量不出一个用户名存不存在。
 * 它是一次性随机生成的口令的散列，那个口令没有留在任何地方。
 */
export const DECOY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$loRWTxXJvo2YUx7QtMZ3Wg$29cwvpMoOxWZz9hKJeF9UKai1l7CtedXiC7xSXqDCP8";

/** 库里存的散列串必须长这样，才算一份 argon2id 散列。 */
const ARGON2ID_HASH = /^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

/** 口令的上限。登录和改密的请求体都卡在 128，建号时超过它的口令将来登录不了。 */
export const MAX_PASSWORD_LENGTH = 128;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /**
   * stored 是 null（账号没有口令）或不是 argon2id 格式（比如旧系统的 PBKDF2 十六进制串）时，
   * 对假散列算一次，然后回 false：按口令不对处理，不报错，也不试旧算法（规格 I-08）。
   * 这里只拦格式。库自己抛的错不接：那是真故障，不要把故障说成「口令不对」。
   */
  verify(stored: string | null | undefined, password: string): Promise<boolean>;
}

/** argon2 这个包用到的两个函数。单独拎出来，测试才能数它到底被调了几次。 */
export interface Argon2 {
  hash(password: string, options: typeof PASSWORD_HASH_OPTIONS): Promise<string>;
  verify(digest: string, password: string): Promise<boolean>;
}

const argon2: Argon2 = { hash, verify };

/** 全走异步接口（规格 I-07）：argon2 在线程池里算，不挡住事件循环上的别的请求。 */
export function createArgon2Hasher(lib: Argon2 = argon2): PasswordHasher {
  return {
    hash: (password) => lib.hash(password, PASSWORD_HASH_OPTIONS),
    async verify(stored, password) {
      if (stored === null || stored === undefined || !ARGON2ID_HASH.test(stored)) {
        await lib.verify(DECOY_HASH, password);
        return false;
      }
      return lib.verify(stored, password);
    },
  };
}

export const argon2PasswordHasher: PasswordHasher = createArgon2Hasher();
