import { API_PREFIX, errors, json, route } from "@nexus/http-kit";
import { z } from "zod";

const openApiDocumentSchema = z.record(z.string(), z.unknown());

/** 契约文档本身也是一个接口：任何客户端和智能体都能照着它说话（主张 P1、P2）。 */
export const docRoute = route("admin", {
  method: "get",
  path: `${API_PREFIX}/doc`,
  operationId: "getOpenApiDocument",
  summary: "接口契约（OpenAPI 3.1）",
  description: "每个操作都带 x-auth 标注访问级别。",
  tags: ["system"],
  responses: {
    200: json(openApiDocumentSchema, "整份契约文档"),
    ...errors(401, 403, 500),
  },
});

export const docContract = { name: "system", routes: [docRoute] } as const;
