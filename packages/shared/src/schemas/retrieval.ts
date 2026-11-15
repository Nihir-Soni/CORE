import { z } from "zod";

export const retrievalSchema = z.object({
  query: z.string().trim().min(1, "Query cannot be empty"),
  topK: z.number().int().positive().max(50, "Maximum topK is 50").optional(),
  mode: z.enum(["hybrid", "vector", "text"]).optional(),
  maxTokens: z.number().int().positive().max(100000).optional(),
  rerank: z.boolean().optional(),
});

export type RetrievalInput = z.infer<typeof retrievalSchema>;
