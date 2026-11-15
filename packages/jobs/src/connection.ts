import { env } from "@core/shared";

export const connection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
};
