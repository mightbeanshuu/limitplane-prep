const MONTHLY_QUOTA_SCRIPT = `
local quota = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local resetsAt = tonumber(ARGV[3])
local used = tonumber(redis.call("GET", KEYS[1])) or 0
local allowed = 0

if used + cost <= quota then
  used = used + cost
  redis.call("SET", KEYS[1], tostring(used))
  allowed = 1
end

if redis.call("EXISTS", KEYS[1]) == 1 then
  redis.call("PEXPIREAT", KEYS[1], resetsAt)
end

return { allowed, tostring(used) }
`;

// Shared calendar-month quota for horizontally scaled gateway replicas.
// The month is part of the key, so a new UTC month starts a fresh counter.
// Lua keeps check + spend atomic when many replicas charge it concurrently.
export class RedisMonthlyQuotaLimiter {
  constructor({ client, prefix = "lp:monthly", keyHasher, now = () => Date.now() } = {}) {
    if (!client) throw new Error("RedisMonthlyQuotaLimiter needs a connected Redis client");
    this.client = client;
    this.prefix = prefix;
    this.keyHasher = keyHasher;
    this.now = now;
  }

  monthId(t = this.now()) {
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  }

  resetsAt(t = this.now()) {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }

  storageKey(key, t = this.now()) {
    const logicalKey = `${key}:${this.monthId(t)}`;
    return `${this.prefix}:${this.keyHasher ? this.keyHasher(logicalKey) : logicalKey}`;
  }

  async check({ key, quota, cost = 1 }) {
    const time = this.now();
    const resetsAt = this.resetsAt(time);
    const [allowed, usedValue] = await this.client.eval(MONTHLY_QUOTA_SCRIPT, {
      keys: [this.storageKey(key, time)],
      arguments: [String(quota), String(cost), String(resetsAt)],
    });
    const used = Number(usedValue);
    return {
      allowed: Number(allowed) === 1,
      used,
      remaining: Math.max(quota - used, 0),
      resetsAt,
    };
  }
}
