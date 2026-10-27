import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { RedisMonthlyQuotaLimiter } from "../../src/algorithms/redisMonthlyQuotaLimiter.js";
import { RedisTokenBucketLimiter } from "../../src/algorithms/redisTokenBucketLimiter.js";
import { createRedisFingerprints } from "../../src/gateway/redisFingerprints.js";
import { createRedisIpReputation } from "../../src/gateway/redisIpReputation.js";
import { createIpHasher, createKeyHasher } from "../../src/redis/ipIdentity.js";

let client;
const prefix = `test:lp:${process.pid}`;
const rawIp = "203.0.113.42";
const hashIp = createIpHasher({ secret: "integration-secret" });

before(async () => {
  client = createClient();
  await client.connect();
});

after(async () => {
  const keys = await client.keys(`${prefix}:*`);
  if (keys.length) await client.del(keys);
  await client.quit();
});

test("Redis token bucket is atomic, expiring, and shared across limiter instances", async () => {
  const bucketPrefix = `${prefix}:bucket`;
  const keyHasher = createKeyHasher({ secret: "integration-secret", namespace: "bucket" });
  const firstProcess = new RedisTokenBucketLimiter({ client, prefix: bucketPrefix, ttlMs: 60_000, keyHasher });
  const secondProcess = new RedisTokenBucketLimiter({ client, prefix: bucketPrefix, ttlMs: 60_000, keyHasher });
  const key = `anon:${rawIp}:free:/ping`;
  await client.del(firstProcess.storageKey(key));

  assert.equal((await firstProcess.check({ key, capacity: 2, refillRatePerMs: 0.000001 })).allowed, true);
  assert.equal((await firstProcess.check({ key, capacity: 2, refillRatePerMs: 0.000001 })).allowed, true);
  assert.equal((await secondProcess.check({ key, capacity: 2, refillRatePerMs: 0.000001 })).allowed, false);
  assert.ok(await client.pTTL(firstProcess.storageKey(key)) > 0);
  assert.doesNotMatch(firstProcess.storageKey(key), /203\.0\.113\.42/);
});

test("monthly quota is atomic and shared across gateway replicas", async () => {
  const monthlyPrefix = `${prefix}:monthly`;
  const keyHasher = createKeyHasher({ secret: "integration-secret", namespace: "monthly" });
  const firstReplica = new RedisMonthlyQuotaLimiter({ client, prefix: monthlyPrefix, keyHasher });
  const secondReplica = new RedisMonthlyQuotaLimiter({ client, prefix: monthlyPrefix, keyHasher });
  const key = `acme:pro:monthly`;
  const storageKey = firstReplica.storageKey(key);
  await client.del(storageKey);

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      (i % 2 === 0 ? firstReplica : secondReplica).check({ key, quota: 10, cost: 1 })
    )
  );

  assert.equal(results.filter((result) => result.allowed).length, 10);
  const blocked = await secondReplica.check({ key, quota: 10, cost: 1 });
  assert.deepEqual({ allowed: blocked.allowed, used: blocked.used, remaining: blocked.remaining }, {
    allowed: false,
    used: 10,
    remaining: 0,
  });
  assert.ok(await client.pTTL(storageKey) > 0);
  assert.doesNotMatch(storageKey, /acme/);
});

test("fingerprint history survives a new store instance and never stores the raw IP", async () => {
  const fingerprintPrefix = `${prefix}:fingerprint`;
  const firstProcess = createRedisFingerprints({ client, hashIp, prefix: fingerprintPrefix, ttlMs: 60_000 });
  await client.del(firstProcess.storageKey(rawIp));

  for (let i = 0; i < 8; i++) {
    await firstProcess.observe({
      tenantId: rawIp,
      at: i * 200,
      route: "/scan",
      allowed: i % 2 !== 0,
    });
  }

  const secondProcess = createRedisFingerprints({ client, hashIp, prefix: fingerprintPrefix, ttlMs: 60_000 });
  assert.equal((await secondProcess.laneFor(rawIp)).label, "retry_bug");
  assert.doesNotMatch(firstProcess.storageKey(rawIp), /203\.0\.113\.42/);
  assert.ok(await client.pTTL(firstProcess.storageKey(rawIp)) > 0);
  assert.ok((await client.lRange(firstProcess.storageKey(rawIp), 0, -1)).every((row) => !row.includes(rawIp)));
});

test("persistent strikes shorten the next storm threshold and lengthen its cooldown", async () => {
  const reputation = createRedisIpReputation({
    client,
    hashIp,
    prefix: `${prefix}:reputation`,
    strikeTtlMs: 60_000,
    minimumThreshold: 3,
    maxCooldownMs: 60_000,
  });
  const keys = reputation.keysFor("acme", rawIp);
  await client.del([keys.storm, keys.ban, keys.strikes]);

  let result;
  for (let i = 0; i < 10; i++) {
    result = await reputation.recordBurstBlock({
      tenantId: "acme",
      ip: rawIp,
      threshold: 10,
      windowMs: 60_000,
      cooldownMs: 5_000,
    });
  }
  assert.equal(result.triggered, true);
  assert.equal(result.threshold, 10);
  assert.equal(result.strikes, 1);
  assert.equal(result.cooldownMs, 5_000);
  assert.ok(await reputation.cooldown("acme", rawIp) > 0);

  await client.del(keys.ban); // simulate the first cooldown having expired
  for (let i = 0; i < 8; i++) {
    result = await reputation.recordBurstBlock({
      tenantId: "acme",
      ip: rawIp,
      threshold: 10,
      windowMs: 60_000,
      cooldownMs: 5_000,
    });
  }
  assert.equal(result.triggered, true);
  assert.equal(result.threshold, 8);
  assert.equal(result.strikes, 2);
  assert.equal(result.cooldownMs, 10_000);
  assert.doesNotMatch(keys.ban, /203\.0\.113\.42/);
  assert.ok(await client.pTTL(keys.strikes) > 0);
});
