import { createApiClient, failureOf, type ApiFailure, type CallResult } from "@nexus/api-client";
import { detailsOf, NETWORK_FAILURE, type FailureDetails } from "./failure.ts";

/** 全应用唯一的一个接口客户端。页面不自己拼请求。 */
export const api = createApiClient();

/** 调用一个接口的结果摊开后的样子：要么拿到了数据，要么拿到翻好的失败和它带的附加信息。 */
export type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; failure: ApiFailure; details: FailureDetails };

/**
 * 调一个接口，把两种失败并成一种。
 * 接口回了错误，响应体是统一的形状，由 failureOf 翻；浏览器根本没连上时 fetch 直接抛异常，
 * 没有响应也没有响应体，这里把它也做成同一个形状。页面只认 Outcome。
 */
export async function callApi<T>(
  call: () => Promise<CallResult & { data?: T }>,
): Promise<Outcome<T>> {
  let result: CallResult & { data?: T };
  try {
    result = await call();
  } catch {
    return { ok: false, failure: NETWORK_FAILURE, details: {} };
  }
  if (result.data === undefined)
    return { ok: false, failure: failureOf(result), details: detailsOf(result) };
  return { ok: true, data: result.data };
}
