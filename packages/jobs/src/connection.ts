
import { env } from "@core/shared";

const redisUrl = env.REDIS_URL
  ? new URL(env.REDIS_URL)
  : null;

export const connection = redisUrl
  ? {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username
      ? decodeURIComponent(redisUrl.username)
      : undefined,
    password: redisUrl.password
      ? decodeURIComponent(redisUrl.password)
      : undefined,
    ...(redisUrl.protocol === "rediss:"
      ? { tls: {} }
      : {}),
  }
  : {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  };
