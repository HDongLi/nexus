import createClient, { type Client, type ClientOptions } from "openapi-fetch";
import type { paths } from "./schema.d.ts";

export type { paths } from "./schema.d.ts";

/** 类型安全的接口客户端：路径、参数、返回值都来自生成的契约。 */
export type ApiClient = Client<paths>;

export interface ApiClientOptions {
  /** 同源部署时留空：页面与接口同域，由反向代理转给后端（任务书 §3.4）。 */
  baseUrl?: string | undefined;
  /** 自己的 fetch（比如测试里、或者要走代理时）。收到的是一个 Request 对象。 */
  fetch?: ((input: Request) => Promise<Response>) | undefined;
  headers?: Record<string, string> | undefined;
}

/** 会话在 HttpOnly cookie 里，所以请求一律带上凭据。 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const init: ClientOptions = {
    credentials: "include",
    headers: { Accept: "application/json", ...options.headers },
  };
  if (options.baseUrl !== undefined) init.baseUrl = options.baseUrl;
  if (options.fetch !== undefined) init.fetch = options.fetch;
  return createClient<paths>(init);
}

/** 一次失败，翻成了能直接显示给人的样子。 */
export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  requestId: string;
}

/** 客户端一次调用的结果：成功时 `data` 有值；失败时 `error` 是它读出来的响应体。 */
export interface CallResult {
  response: Response;
  data?: unknown;
  error?: unknown;
}

/**
 * 把一次失败的调用翻成 ApiFailure。接口的失败统一回 `{ error: { code, message, requestId } }`；
 * 回合不是这个形状（比如网关回的裸文本）也不崩，照样给出状态码和请求号。
 *
 * 收的是客户端返回的整个结果，不是其中的 response。客户端已经把响应体读过了，再读一次
 * 只会报「响应体已用过」，原因就这样丢了：2026-11-26 端到端实测，页面把后端说的
 * 「身份模块还没有接入」显示成了「服务器出了问题」，请求号倒还在（它来自响应头）。
 */
export function failureOf(result: CallResult): ApiFailure {
  const error = (result.error as { error?: Partial<ApiFailure> } | null)?.error;
  const pick = (value: unknown, fallback: string): string =>
    typeof value === "string" && value ? value : fallback;
  return {
    status: result.response.status,
    code: pick(error?.code, `http_${result.response.status}`),
    message: pick(error?.message, `服务器回了 ${result.response.status}，没有说明原因`),
    requestId: pick(error?.requestId, result.response.headers.get("x-request-id") ?? "unknown"),
  };
}
