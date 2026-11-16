import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_CHAT_MODEL: z.string().optional().default("gemini-3.5-flash"),
  MISTRAL_API_KEY: z.string().min(1).optional(),
  MISTRAL_CHAT_MODEL: z.string().optional().default("open-mistral-7b"),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_URL: z.string().url().optional(),
});

export const env = envSchema.parse(process.env);