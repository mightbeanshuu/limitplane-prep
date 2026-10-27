import { createClient } from "redis";
import { RedisMonthlyQuotaLimiter } from "../algorithms/redisMonthlyQuotaLimiter.js";
import { RedisTokenBucketLimiter } from "../algorithms/redisTokenBucketLimiter.js";
import { createRedisFingerprints } from "../gateway/redisFingerprints.js";
import { createRedisIpReputation } from "../gateway/redisIpReputation.js";
import { createIpHasher, createKeyHasher } from "./ipIdentity.js";

export async function createRedisIpRuntime({ url, secret, onError = console.error } = {}) {
  if (!url) return null;
  const hashIp = createIpHasher({ secret });
  const hashBucketKey = createKeyHasher({ secret, namespace: "bucket" });
  const hashMonthlyKey = createKeyHasher({ secret, namespace: "monthly" });
  const client = createClient({ url });
  client.on("error", (error) => onError(`[redis] ${error.message}`));
  await client.connect();

  const limiter = new RedisTokenBucketLimiter({ client, keyHasher: hashBucketKey });
  return {
    client,
    limiter,
    monthly: new RedisMonthlyQuotaLimiter({ client, keyHasher: hashMonthlyKey }),
    ipFingerprints: createRedisFingerprints({ client, hashIp }),
    ipReputation: createRedisIpReputation({ client, hashIp }),
    close: () => client.quit(),
  };
}
