import type { paths } from "@nexus/api-client";
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { api, callApi } from "./api.ts";
import { LOGIN_PATH, loginSearch } from "./auth-gate.ts";

type MeOk = NonNullable<
  paths["/api/v1/auth/me"]["get"]["responses"][200]
>["content"]["application/json"];

/** 当前登录的人。形状来自生成的契约，和登录、我是谁两个接口回的是同一个。 */
export type CurrentUser = NonNullable<MeOk>["user"];

/**
 * 「我是谁」。登没登录只问这一个接口：要登录的页面在路由的闸里等它，侧栏显示当前用户也读它。
 */
export const meQuery = queryOptions({
  queryKey: ["auth", "me"],
  queryFn: async (): Promise<CurrentUser> => {
    const result = await callApi(() => api.GET("/api/v1/auth/me"));
    if (!result.ok) throw new Error(result.failure.message);
    return result.data.user;
  },
  // 不重试：没登录就是没登录，再问一次只是让转到登录页慢一拍。
  retry: false,
  // 五分钟内换页面不再问。期间真过期了，受保护的接口会回 401，那边会把人送回登录页。
  staleTime: 5 * 60_000,
});

export function useCurrentUser() {
  return useQuery(meQuery);
}

/** 登录成功：把人写进「我是谁」的缓存，接下来的页面不用再多问一次。 */
export function signedIn(queryClient: QueryClient, user: CurrentUser): void {
  // 上一个人留下的缓存一并清掉。
  queryClient.clear();
  queryClient.setQueryData(meQuery.queryKey, user);
}

/**
 * 会话没了（哪个接口回了 401）：忘掉这个人，送回登录页，登录后回到现在这一页。
 * 只清「我是谁」这一条，不清整个缓存：页面还挂着，清了它会立刻重新去取。
 */
export function useExpireSession(): (target?: string) => void {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(
    (target: string = router.latestLocation.href): void => {
      queryClient.removeQueries({ queryKey: meQuery.queryKey });
      void router.navigate({ to: LOGIN_PATH, search: loginSearch(target), replace: true });
    },
    [queryClient, router],
  );
}

/** 退出登录。成功了去登录页；没成功（后端连不上）留在原地，由调用方把原因显示出来。 */
export function useSignOut(): () => Promise<boolean> {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(async (): Promise<boolean> => {
    const result = await callApi(() => api.POST("/api/v1/auth/logout"));
    // 401 也算退出了：服务端本来就没有这条会话，浏览器那头的 cookie 一并清掉就好。
    if (!result.ok && result.failure.code !== "auth_required") return false;
    // 先忘掉这个人再去登录页：登录页看见缓存里还有人，会把人原路送回来。只清「我是谁」这一条，
    // 别的等离开这一页再清：页面上挂着的查询一旦被清掉会立刻重新去取，这时已经没有登录了。
    queryClient.removeQueries({ queryKey: meQuery.queryKey });
    await router.navigate({ to: LOGIN_PATH, replace: true });
    queryClient.clear();
    return true;
  }, [queryClient, router]);
}
