// createLimitPlane — the drop-in layer.
//
// This is the piece that makes LimitPlane usable on ANY site: you create it
// once with your policy, then bolt it in front of your routes. It works two
// ways with the SAME function:
//
//   Express / connect style:            app.use(lp.middleware)
//   Plain Node http style:              const d = await lp.middleware(req, res);
//                                       if (!d.allowed) return; // 429 already sent
//
// What it does per request, in order:
//   1. identify  -> who is this? (api key -> tenant + tier, else anon by IP)
//   2. resolve   -> which jar, how big, how much does THIS request cost?
//   3. check IP  -> adaptive visitor bucket (when per-IP fingerprints are wired)
//   4. check org -> base-plan tenant bucket; both guards must approve
//   5. headers   -> always tell the client their budget (X-RateLimit-*)
//   6. verdict   -> pass through, or send 429 + Retry-After + reason
//   7. learn     -> record the outcome; it can change the NEXT request's lane

import { TokenBucketLimiter } from "../algorithms/tokenBucketLimiter.js";
import { MonthlyQuotaLimiter } from "../algorithms/monthlyQuotaLimiter.js";
import { PolicyEngine } from "./policyEngine.js";
import { AuditLog } from "./auditLog.js";

export function createLimitPlane({
  policy, // the rulebook (tiers, routes, tenants) — required
  limiter = new TokenBucketLimiter(), // the burst muscle; swap in Redis for multi-server
  ipLimiter = new TokenBucketLimiter(), // second burst guard: isolates one abusive visitor IP
  monthly = new MonthlyQuotaLimiter(), // the plan meter (only used if a tier sets monthlyQuota)
  audit = new AuditLog(), // the diary
  automations, // optional autopilot: consulted for bans, fed every decision
  fingerprints, // optional tenant-level classifier (analytics + legacy adaptive fallback)
  ipFingerprints, // optional per-IP classifier: drives the second adaptive bucket
  onDecision, // optional hook: gets every audit event (metrics, alerts...)
} = {}) {
  const engine = new PolicyEngine(policy);

  // One request -> one decision. Two questions, in order:
  //   monthly: "does your PLAN have units left this month?"  (billing)
  //   burst:   "are you going too fast right now?"           (protection)
  // Monthly is asked first — no point rationing the speed of requests the
  // plan can't pay for at all.
  async function check({ apiKey, ip, route, ua }) {
    const { tenantId, tier } = engine.identify({ apiKey, ip }); // step 1: who
    const plan = engine.resolve({ tenantId, tier, route }); // step 2: what jar, what price

    // step 0 (autopilot): is this client serving an auto-cooldown ban?
    // Checked BEFORE any meter so a banned client can't even spend tokens.
    const cooldown = automations?.resolveCooldown
      ? await automations.resolveCooldown(tenantId, ip)
      : automations?.cooldown
        ? automations.cooldown(tenantId, ip)
        : { remainingMs: automations ? automations.banRemainingMs(tenantId, ip) : 0, scope: "tenant" };
    const banMs = cooldown.remainingMs;
    if (banMs > 0) {
      const event = audit.record({
        allowed: false,
        key: plan.key,
        route,
        tenantId,
        ip,
        tier,
        costClass: plan.costClass,
        cost: plan.cost,
        remaining: 0,
        reason: "auto_cooldown",
        scope: cooldown.scope,
      });
      await automations.onDecision(event); // it ignores its own bans, but the diary line still flows
      if (onDecision) onDecision(event);
      return {
        allowed: false,
        reason: "auto_cooldown",
        remaining: 0,
        limit: plan.capacity,
        cost: plan.cost,
        costClass: plan.costClass,
        retryAfterMs: banMs,
        tenantId,
        tier,
        monthly: null,
        monthlyQuota: plan.monthlyQuota,
        scope: cooldown.scope,
      };
    }

    // step 3a: the monthly plan meter (skipped when the tier has no cap)
    let month = null;
    if (plan.monthlyQuota !== undefined) {
      month = await monthly.check({ key: plan.monthlyKey, quota: plan.monthlyQuota, cost: plan.cost });
    }

    // With per-IP enforcement enabled, the tenant keeps its base-plan bucket
    // while each visitor gets a second behavior-scaled bucket. Without it, the
    // old tenant-adaptive behavior remains available for existing integrations.
    const useIpGuard = Boolean(ipFingerprints && ip);
    const tenantLane = fingerprints ? await fingerprints.laneFor(tenantId) : null;
    const tenantCapacity = !useIpGuard && tenantLane
      ? Math.max(plan.cost, Math.round(plan.capacity * tenantLane.burstMult))
      : plan.capacity;
    const tenantRefillRatePerMs = !useIpGuard && tenantLane
      ? plan.refillRatePerMs * tenantLane.refillMult
      : plan.refillRatePerMs;

    const ipLane = useIpGuard ? await ipFingerprints.laneFor(ip) : null;
    const ipKey = useIpGuard && ipFingerprints.keyFor ? ipFingerprints.keyFor(ip) : ip;
    const ipCapacity = ipLane
      ? Math.max(plan.cost, Math.round(plan.capacity * ipLane.burstMult))
      : null;
    const ipRefillRatePerMs = ipLane
      ? plan.refillRatePerMs * ipLane.refillMult
      : null;

    // step 3b: the burst limiter — but only spend burst tokens if the plan
    // said yes (a request the plan rejected shouldn't drain the bucket too).
    let result = { allowed: false, remaining: 0 };
    let tenantResult = null;
    let ipResult = null;
    let scope = month && !month.allowed ? "monthly" : null;
    if (!month || month.allowed) {
      if (useIpGuard) {
        ipResult = await ipLimiter.check({
          key: `${plan.key}:ip:${ipKey}`,
          capacity: ipCapacity,
          refillRatePerMs: ipRefillRatePerMs,
          cost: plan.cost,
        });
        if (!ipResult.allowed) {
          result = ipResult;
          scope = "ip";
        }
      }

      if (!useIpGuard || ipResult.allowed) {
        tenantResult = await limiter.check({
          key: plan.key,
          capacity: tenantCapacity,
          refillRatePerMs: tenantRefillRatePerMs,
          cost: plan.cost,
        });
        result = tenantResult;
        if (!tenantResult.allowed) scope = "tenant";
      }
    }

    const allowed = (month ? month.allowed : true) && result.allowed;
    // WHY was it blocked? Different reasons deserve different fixes:
    // monthly -> upgrade your plan or wait for the 1st; burst -> just slow down.
    const reason = allowed ? null : month && !month.allowed ? "monthly_quota" : "burst";

    // How long until the burst jar refills enough? Only meaningful for burst blocks.
    const missing = Math.max(plan.cost - result.remaining, 0);
    const blockedRefillRate = scope === "ip" ? ipRefillRatePerMs : tenantRefillRatePerMs;
    const retryAfterMs =
      reason === "burst" ? Math.ceil(missing / blockedRefillRate) : 0;

    const effectiveLimit = useIpGuard
      ? Math.min(tenantCapacity, ipCapacity)
      : tenantCapacity;
    const effectiveRemaining = useIpGuard && allowed
      ? Math.min(tenantResult.remaining, ipResult.remaining)
      : result.remaining;

    // step 6: diary entry (recorded for allowed AND blocked — both are facts)
    const event = audit.record({
      allowed,
      key: plan.key,
      route,
      tenantId,
      ip,
      tier,
      costClass: plan.costClass,
      cost: plan.cost,
      remaining: effectiveRemaining,
      reason,
      scope,
      tenantRemaining: tenantResult?.remaining,
      ipRemaining: ipResult?.remaining,
      monthlyUsed: month?.used,
      monthlyRemaining: month?.remaining,
      label: ipLane?.label ?? tenantLane?.label,
      tenantLabel: tenantLane?.label,
      ipLabel: ipLane?.label,
      ua, // user-agent string, for device/OS identification
    });
    if (fingerprints) await fingerprints.observe(event); // aggregate tenant visibility
    if (useIpGuard) await ipFingerprints.observe({ ...event, tenantId: ip }); // next request uses the new IP label
    if (automations) await automations.onDecision(event); // feed the autopilot
    if (onDecision) onDecision(event);

    return {
      allowed,
      reason,
      remaining: effectiveRemaining,
      limit: effectiveLimit,
      cost: plan.cost,
      costClass: plan.costClass,
      retryAfterMs,
      tenantId,
      tier,
      monthly: month, // { used, remaining, resetsAt } or null
      monthlyQuota: plan.monthlyQuota,
      scope,
      lane: ipLane?.label ?? tenantLane?.label ?? null,
      tenantRemaining: tenantResult?.remaining,
      ipRemaining: ipResult?.remaining,
    };
  }

  // The universal middleware. Express passes (req, res, next); plain http
  // passes (req, res) and uses the returned decision instead of next().
  async function middleware(req, res, next) {
    const decision = await check({
      apiKey: req.headers["x-api-key"], // who they claim to be
      // behind a proxy (Render/Vercel) the real client is in x-forwarded-for
      ip: (req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket?.remoteAddress,
      route: (req.url ?? "/").split("?")[0], // path only, no query string
      ua: req.headers["user-agent"],
    });

    // step 4: budget headers on EVERY response, allowed or not — good API
    // citizens tell clients how much budget is left before blocking them.
    res.setHeader("X-RateLimit-Limit", String(decision.limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(decision.remaining, 0)));
    res.setHeader("X-LimitPlane-Cost-Class", decision.costClass);
    if (decision.scope) res.setHeader("X-LimitPlane-Limit-Scope", decision.scope);
    if (decision.lane) res.setHeader("X-LimitPlane-Lane", decision.lane);
    if (decision.tenantRemaining !== undefined) {
      res.setHeader("X-RateLimit-Tenant-Remaining", String(Math.max(decision.tenantRemaining, 0)));
    }
    if (decision.ipRemaining !== undefined) {
      res.setHeader("X-RateLimit-IP-Remaining", String(Math.max(decision.ipRemaining, 0)));
    }
    if (decision.monthly) {
      res.setHeader("X-Monthly-Limit", String(decision.monthlyQuota));
      res.setHeader("X-Monthly-Remaining", String(decision.monthly.remaining));
      res.setHeader("X-Monthly-Reset", new Date(decision.monthly.resetsAt).toISOString());
    }

    if (!decision.allowed) {
      // step 5 (blocked): standard 429, but the MESSAGE depends on WHY.
      // Burst block: slow down, retry in seconds. Monthly block: your plan
      // is spent — upgrade, or wait for the 1st. Different problems.
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json");

      if (decision.reason === "auto_cooldown") {
        const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);
        res.setHeader("Retry-After", String(retryAfterSeconds));
        res.end(
          JSON.stringify({
            error: "temporarily_blocked",
            message: `Too many rapid-fire blocked requests (looks like a retry loop or abuse). Auto-cooldown lifts in ~${retryAfterSeconds}s.`,
            retryAfterSeconds,
          })
        );
      } else if (decision.reason === "monthly_quota") {
        const resetsAt = new Date(decision.monthly.resetsAt).toISOString();
        res.setHeader("Retry-After", String(Math.ceil((decision.monthly.resetsAt - Date.now()) / 1000)));
        res.end(
          JSON.stringify({
            error: "monthly_quota_exhausted",
            message: `Your ${decision.tier} plan's ${decision.monthlyQuota} units for this month are used up. Upgrade your plan or wait until ${resetsAt}.`,
            resetsAt,
            upgrade: "/v1/billing/plans",
          })
        );
      } else {
        const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);
        res.setHeader("Retry-After", String(retryAfterSeconds));
        res.end(
          JSON.stringify({
            error: "rate_limited",
            message: `This ${decision.costClass} request costs ${decision.cost} tokens but your ${decision.tier} tier bucket has ${Math.max(decision.remaining, 0)}. Retry in ~${retryAfterSeconds}s.`,
            retryAfterSeconds,
          })
        );
      }
      return decision; // plain-http callers see allowed: false and stop
    }

    if (next) next(); // Express keeps going down the chain
    return decision; // plain-http callers see allowed: true and continue
  }

  return { check, middleware, audit };
}
