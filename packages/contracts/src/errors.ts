import { z } from "zod";

/**
 * 所有失败都回这一个形状：校验不过、未登录、没权限、找不到、服务器错误。
 * 页面据此显示「为什么失败」，并带上请求号方便对日志（实弹条款 2、3）。
 */
export const errorBody = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    /** 进一步的说明，比如校验到底哪一项不对。永远是能直接转成 JSON 的对象。 */
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ErrorBody = z.output<typeof errorBody>;
