import { z } from "zod";

export const chatSchema = z.object({
  query: z.string().trim().min(1, "query cannot be empty"),
  topK: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional(),
  stream: z.boolean().optional(),
  mode: z.enum(["hybrid", "vector", "text"]).optional(),
  maxTokens: z.number().int().positive().max(100000).optional(),
  rerank: z.boolean().optional(),
  documentIds: z.array(z.string().min(1)).optional(),
});

export type ChatRequestInput = z.infer<typeof chatSchema>;
