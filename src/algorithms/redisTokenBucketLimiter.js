const TOKEN_BUCKET_SCRIPT = `
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local ttlMs = tonumber(ARGV[4])
local state = redis.call("HMGET", KEYS[1], "tokens", "lastRefill")
local tokens = tonumber(state[1])
local lastRefill = tonumber(state[2])

if not tokens or not lastRefill then
  tokens = capacity
  lastRefill = now
else
  local elapsed = math.max(now - lastRefill, 0)
  tokens = math.min(tokens + elapsed * refillRate, capacity)
end

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call("HSET", KEYS[1], "tokens", tostring(tokens), "lastRefill", tostring(now))
redis.call("PEXPIRE", KEYS[1], ttlMs)
return { allowed, tostring(tokens) }
`;

export class RedisTokenBucketLimiter {
  constructor({ client, prefix = "lp:bucket", ttlMs = 3_600_000, keyHasher }) {
    if (!client) throw new Error("RedisTokenBucketLimiter needs a connected Redis client");
    this.client = client;
    this.prefix = prefix;
    this.ttlMs = ttlMs;
    this.keyHasher = keyHasher;
  }

  storageKey(key) {
    return `${this.prefix}:${this.keyHasher ? this.keyHasher(key) : key}`;
  }

  async check({ key, capacity, refillRatePerMs, cost = 1 }) {
    const [allowed, tokens] = await this.client.eval(TOKEN_BUCKET_SCRIPT, {
      keys: [this.storageKey(key)],
      arguments: [String(capacity), String(refillRatePerMs), String(cost), String(this.ttlMs)],
    });
    return { allowed: Number(allowed) === 1, remaining: Math.floor(Number(tokens)) };
  }
}
