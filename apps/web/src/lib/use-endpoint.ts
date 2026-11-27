import type { CallResult } from "@nexus/api-client";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { callApi, type Outcome } from "./api.ts";
import { useExpireSession } from "./session.ts";

/**
 * 调一个接口：成功的给数据，失败的给翻好的原因。页面只管显示。
 * 失败只看有没有数据：响应体读不出来的时候，error 也是空的。
 */
export function useEndpoint<T>(key: string[], call: () => Promise<CallResult & { data?: T }>) {
  const expire = useExpireSession();
  const href = useLocation({ select: (location) => location.href });
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<Outcome<T>> => {
      const outcome = await callApi(call);
      // 人坐在页面上没动，会话却没了（别处改了口令、账号被停用）：受保护的接口一回来就是 401，
      // 不让人对着一张出错的页面找出口，直接送回登录页。
      if (!outcome.ok && outcome.failure.code === "auth_required") expire(href);
      return outcome;
    },
  });
}
