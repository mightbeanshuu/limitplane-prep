import { classifyFingerprint, LANES } from "./fingerprint.js";

const APPEND_EVENT_SCRIPT = `
redis.call("RPUSH", KEYS[1], ARGV[1])
redis.call("LTRIM", KEYS[1], -tonumber(ARGV[2]), -1)
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[3]))
return redis.call("LRANGE", KEYS[1], 0, -1)
`;

export function createRedisFingerprints({
  client,
  hashIp,
  window = 30,
  ttlMs = 3_600_000,
  prefix = "lp:fingerprint",
  onLabelChange,
} = {}) {
  if (!client || !hashIp) throw new Error("createRedisFingerprints needs client and hashIp");
  const cache = new Map();
  const keyFor = (ip) => hashIp(ip);
  const storageKey = (ip) => `${prefix}:${keyFor(ip)}`;
  const parse = (rows) => rows.map((row) => JSON.parse(row));

  async function laneFor(ip) {
    const next = classifyFingerprint(parse(await client.lRange(storageKey(ip), 0, -1)));
    cache.set(keyFor(ip), next);
    return { label: next.label, ...LANES[next.label] };
  }

  async function observe(event) {
    const safeEvent = {
      at: Number(event.at),
      route: String(event.route ?? "/").slice(0, 512),
      allowed: Boolean(event.allowed),
    };
    const rows = await client.eval(APPEND_EVENT_SCRIPT, {
      keys: [storageKey(event.tenantId)],
      arguments: [JSON.stringify(safeEvent), String(window), String(ttlMs)],
    });
    const next = classifyFingerprint(parse(rows));
    const id = keyFor(event.tenantId);
    const prev = cache.get(id)?.label ?? "warming";
    cache.set(id, next);
    if (next.label !== prev && onLabelChange) onLabelChange(event.tenantId, next, prev);
    return next;
  }

  function get(ip) {
    const value = cache.get(keyFor(ip));
    return value ? { label: value.label, ...value } : null;
  }

  return { observe, laneFor, get, keyFor, storageKey };
}
