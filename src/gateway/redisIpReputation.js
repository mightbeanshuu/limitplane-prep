import { randomUUID } from "node:crypto";

const RECORD_BLOCK_SCRIPT = `
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local windowMs = tonumber(ARGV[1])
local baseThreshold = tonumber(ARGV[2])
local minimumThreshold = tonumber(ARGV[3])
local baseCooldownMs = tonumber(ARGV[4])
local maxCooldownMs = tonumber(ARGV[5])
local strikeTtlMs = tonumber(ARGV[6])

redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - windowMs)
redis.call("ZADD", KEYS[1], now, ARGV[7])
redis.call("PEXPIRE", KEYS[1], windowMs)

local previousStrikes = tonumber(redis.call("GET", KEYS[3])) or 0
local threshold = math.max(minimumThreshold, baseThreshold - previousStrikes * 2)
local count = redis.call("ZCARD", KEYS[1])

if count >= threshold then
  local strikes = redis.call("INCR", KEYS[3])
  redis.call("PEXPIRE", KEYS[3], strikeTtlMs)
  local cooldownMs = math.min(baseCooldownMs * (2 ^ (strikes - 1)), maxCooldownMs)
  redis.call("SET", KEYS[2], '{"reason":"burst_storm"}', "PX", cooldownMs)
  redis.call("DEL", KEYS[1])
  return { 1, count, threshold, strikes, cooldownMs }
end

return { 0, count, threshold, previousStrikes, 0 }
`;

export function createRedisIpReputation({
  client,
  hashIp,
  prefix = "lp",
  strikeTtlMs = 86_400_000,
  minimumThreshold = 3,
  maxCooldownMs = 3_600_000,
} = {}) {
  if (!client || !hashIp) throw new Error("createRedisIpReputation needs client and hashIp");

  function keysFor(tenantId, ip) {
    const subject = hashIp(ip, tenantId);
    return {
      storm: `${prefix}:storm:${subject}`,
      ban: `${prefix}:ban:${subject}`,
      strikes: `${prefix}:strikes:${subject}`,
    };
  }

  async function cooldown(tenantId, ip) {
    const ttl = await client.pTTL(keysFor(tenantId, ip).ban);
    return Math.max(Number(ttl), 0);
  }

  async function strikeCount(tenantId, ip) {
    return Number((await client.get(keysFor(tenantId, ip).strikes)) ?? 0);
  }

  async function recordBurstBlock({ tenantId, ip, threshold, windowMs, cooldownMs }) {
    const keys = keysFor(tenantId, ip);
    const values = await client.eval(RECORD_BLOCK_SCRIPT, {
      keys: [keys.storm, keys.ban, keys.strikes],
      arguments: [
        String(windowMs),
        String(threshold),
        String(minimumThreshold),
        String(cooldownMs),
        String(maxCooldownMs),
        String(strikeTtlMs),
        randomUUID(),
      ],
    });
    return {
      triggered: Number(values[0]) === 1,
      count: Number(values[1]),
      threshold: Number(values[2]),
      strikes: Number(values[3]),
      cooldownMs: Number(values[4]),
    };
  }

  return { cooldown, strikeCount, recordBurstBlock, keysFor };
}
