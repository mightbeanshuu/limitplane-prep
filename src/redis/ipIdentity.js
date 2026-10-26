import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export function normalizeIp(value) {
  let ip = String(value ?? "").split(",")[0].trim().toLowerCase();
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]"));
  if (ip.includes("%")) ip = ip.split("%")[0];
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : "unknown";
}

export function createIpHasher({ secret }) {
  if (!secret) throw new Error("IP_HASH_SECRET is required when Redis IP state is enabled");
  return (ip, tenantId = "") =>
    createHmac("sha256", secret)
      .update(`${tenantId}\0${normalizeIp(ip)}`)
      .digest("hex");
}

export function createKeyHasher({ secret, namespace = "redis-key" }) {
  if (!secret) throw new Error("IP_HASH_SECRET is required when Redis IP state is enabled");
  return (value) =>
    createHmac("sha256", secret)
      .update(`${namespace}\0${String(value)}`)
      .digest("hex");
}
