import { test } from "node:test";
import assert from "node:assert/strict";
import { createIpHasher, createKeyHasher, normalizeIp } from "../../src/redis/ipIdentity.js";

test("IP normalization collapses IPv4-mapped addresses and rejects junk", () => {
  assert.equal(normalizeIp("::ffff:203.0.113.42"), "203.0.113.42");
  assert.equal(normalizeIp("[2001:db8::1]"), "2001:db8::1");
  assert.equal(normalizeIp("not-an-ip"), "unknown");
});

test("HMAC identity is stable, tenant-scoped when requested, and hides the raw IP", () => {
  const hashIp = createIpHasher({ secret: "unit-test-secret" });
  const plain = hashIp("203.0.113.42");
  assert.equal(plain, hashIp("::ffff:203.0.113.42"));
  assert.notEqual(plain, hashIp("203.0.113.42", "acme"));
  assert.doesNotMatch(plain, /203\.0\.113\.42/);
  assert.equal(plain.length, 64);
});

test("Redis IP mode fails loudly without an HMAC secret", () => {
  assert.throws(() => createIpHasher({}), /IP_HASH_SECRET/);
});

test("complete Redis bucket keys are HMACed so anonymous tenant IDs cannot leak IPs", () => {
  const hashKey = createKeyHasher({ secret: "unit-test-secret", namespace: "bucket" });
  const digest = hashKey("anon:203.0.113.42:free:/ping");
  assert.equal(digest.length, 64);
  assert.doesNotMatch(digest, /203\.0\.113\.42/);
});
