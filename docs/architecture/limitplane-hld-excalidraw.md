# LimitPlane HLD — Excalidraw Drawing Pack

This pack describes commit `b2d107b` in `limitplane-prep`. It is based on the implemented code paths, not only README claims.

## Read this before drawing

LimitPlane is one Node.js process with logically separate modules. The boxes inside the process are **logical services**, not independently deployed microservices.

The default running gateway uses:

- in-memory `Map` and `Set` state for burst buckets, monthly usage, bans, audit events, statistics, fingerprints, visitors, and live connections;
- `.tenants.json` for tenants and tiers;
- `.orgs.json` for users, organizations, roles, and attached sites;
- `.memory.jsonl` for append-only incident history.

There is no PostgreSQL or MongoDB in this snapshot. Redis mode is optional: when `REDIS_URL` and `IP_HASH_SECRET` are present, Lua-backed tenant/IP token buckets plus HMAC-keyed fingerprint, ban, storm, and strike state are shared across replicas with bounded TTLs. Without those variables, the default runtime remains in memory. The older Redis fixed-window examples remain separately integration-tested teaching implementations.

## Fastest way to get this into Excalidraw

1. Open Excalidraw.
2. Choose **More tools → Mermaid to Excalidraw**.
3. Paste [limitplane-master-hld.mmd](./limitplane-master-hld.mmd).
4. Import it, ungroup if needed, and adjust spacing.
5. Repeat with [limitplane-request-flow.mmd](./limitplane-request-flow.mmd) and [limitplane-data-flow.mmd](./limitplane-data-flow.mmd) on separate pages.

Use the master HLD for the opening project explanation. Use the request flow when the interviewer asks “walk me through one request.” Use the data-flow diagram when asked about databases, persistence, Redis, or scaling.

## Rendered image files

- [Clean interview HLD](./limitplane-interview-hld.png) — opened in Preview; use this for presentation and narration.
- [Exhaustive master HLD](./limitplane-master-hld.png) — every logical service and connection; zoom in for detailed study.
- [Scalable master SVG](./limitplane-master-hld.svg) — vector version for lossless zoom/import.
- [Protected-request flow](./limitplane-request-flow.png) — one request from arrival to response.
- [Storage and data-flow map](./limitplane-data-flow.png) — process memory, JSON/JSONL persistence, and the separate Redis path.

The editable Mermaid source for the cleaner presentation diagram is [limitplane-interview-hld.mmd](./limitplane-interview-hld.mmd).

## Recommended Excalidraw canvas

- Canvas: landscape, roughly 2400 × 1400.
- Flow direction: left to right.
- Use large dashed containers for architectural zones.
- Use solid arrows for active runtime calls.
- Use dotted arrows for asynchronous notifications or optional integrations.
- Use red dashed arrows for implemented but not runtime-wired production paths.

### Color legend

| Color | Hex | Meaning |
| --- | --- | --- |
| Blue | `#DBEAFE` | Users and clients |
| Indigo | `#E0E7FF` | Entry adapters and UI |
| Purple | `#F3E8FF` | Control plane, identity, billing |
| Green | `#DCFCE7` | Critical request data plane |
| Teal | `#CCFBF1` | Protected application handlers |
| Orange | `#FFEDD5` | Event processing and observability |
| Yellow | `#FEF3C7` | Data stores |
| Pink | `#FCE7F3` | External services |
| Red dashed | `#FEE2E2` | Optional or future production wiring |

## Manual master-HLD layout

Draw eight vertical zones from left to right.

### Zone 1 — Actors

Draw three blue rounded rectangles:

1. **End User / API Client**
2. **Visitor on Connected Website**
3. **Admin / Viewer / Org Member**

### Zone 2 — Entry and deployment modes

Draw five indigo rectangles:

1. **Full Demo Server — `src/server.js`**
2. **Reverse Proxy CLI — `bin/limitplane.js`**
3. **Embedded Middleware — `createLimitPlane()`**
4. **Traffic Beacon — `GET /b?k=&p=`**
5. **Dashboard / Admin UI**

These represent three ways traffic enters the same core:

- full demo application;
- standalone reverse proxy in front of any upstream;
- middleware embedded inside a Node application.

### Zone 3 — Control plane

Draw six purple rectangles:

1. **JWT Authentication**
2. **Role and Organization Authorization**
3. **Admin APIs**
4. **Billing Service**
5. **TenantStore**
6. **Policy Configuration**

Group JWT and organization authorization together visually. Draw Billing → TenantStore and Admin APIs → TenantStore/Policy Configuration.

### Zone 4 — Critical request data plane

Draw these green boxes as one horizontal pipeline:

1. **LimitPlane Middleware**
2. **Policy Engine: identify + resolve**
3. **Autopilot Ban Pre-check**
4. **Monthly Quota Meter**
5. **Per-IP Behavior Fingerprint / Adaptive Lane**
6. **Per-IP Adaptive Token Bucket — visitor isolation**
7. **Tenant Base Token Bucket — aggregate plan guard**
8. **Allow / Block Decision**
9. **Headers + 429 / Continue**

This is the most important part of the diagram. Make these boxes larger than the others.

### Zone 5 — Protected application paths

Draw four teal rectangles:

1. **Demo Handlers — NSFW stub / echo / ping**
2. **Protected Upstream Site — any technology stack**
3. **AI Token-Metering Proxy**
4. **RAG Operations Chat**

Connect an allowed decision to either Demo Handlers or Protected Upstream Site. The selected destination depends on deployment mode.

### Zone 6 — Event and observability plane

Draw seven orange boxes:

1. **Audit Log**
2. **Stats Aggregator**
3. **Autopilot Rules — tenant actions + IP-scoped cooldown**
4. **Tenant and Per-IP Behavior Fingerprint Observers**
5. **Incident Memory / TF-IDF Retrieval**
6. **Visitor, User-Agent, and Geo Tracking**
7. **WebSocket + SSE Push**

Place a small orange circle labeled **`onDecision(event)`** before these boxes. Fan one decision into all relevant consumers.

### Zone 7 — State and persistence

Use yellow database cylinders:

1. **In-memory Maps/Sets**
2. **`.tenants.json`**
3. **`.orgs.json`**
4. **`.memory.jsonl`**

Use a red database cylinder:

5. **Redis + Lua — optional shared runtime for token buckets, HMAC-keyed IP fingerprints, cooldowns, storms, and strikes with TTLs**

### Zone 8 — External integrations

Draw four pink clouds:

1. **Stripe**
2. **Groq LLM API**
3. **Slack / Discord / Generic Alert Webhook**
4. **ip-api.com**

## Numbered arrows for the master diagram

Use these labels directly on Excalidraw arrows.

1. User → entry adapter: **HTTP request**
2. Connected website → beacon: **page path + site API key**
3. Admin → dashboard: **login / observe / manage**
4. Entry adapter → middleware: **req, res**
5. Middleware → policy engine: **API key + IP + normalized route**
6. TenantStore → policy engine: **tenantId + current tier**
7. Policy config → policy engine: **capacity + refill + monthly quota + cost class**
8. Policy engine → ban pre-check: **resolved plan**
9. Autopilot → ban pre-check: **remaining cooldown**
10. Ban pre-check → monthly meter: **not banned**
11. Monthly meter → per-IP lane: **monthly allowance remains**
12. Per-IP lane → IP bucket: **adjusted capacity/refill**
13. IP bucket → tenant bucket: **visitor passed; check aggregate plan burst**
14. Tenant bucket → decision: **both guards allowed + remaining**
15. Decision → client: **429 + Retry-After when blocked**
16. Decision → protected handler/upstream: **continue when allowed**
17. Decision → audit/event fan-out: **immutable decision facts**
18. Event fan-out → stats: **counters and chart points**
19. Event fan-out → Autopilot: **quota/cap/storm signals**
20. Event fan-out → fingerprints: **timing, route, allowed**
21. Event fan-out → memory: **notable incidents**
22. Event fan-out → WebSocket/SSE: **live dashboard event**
23. Autopilot → alert webhook: **asynchronous notification**
24. Autopilot/explainer → Groq: **sanitized audit metadata**
25. Visitor tracker → ip-api.com: **public IP lookup**
26. Billing → Stripe: **create hosted checkout**
27. Stripe → billing webhook: **signed subscription event**
28. Billing → TenantStore: **upgrade/downgrade tier**
29. TenantStore → policy engine: **next request sees new tier**
30. AI token proxy → Groq: **prompt / completion**
31. Groq → AI token proxy: **response + actual token usage**
32. AI token proxy → monthly meter: **reconcile actual units**
33. Middleware ⇢ Redis: **dashed: production-compatible distributed limiter required**

## Main request flow

The exact protected-request sequence is:

1. Extract API key, trusted client IP, route, and user-agent.
2. Identify a known tenant or create an anonymous free-tier identity.
3. Resolve tier limits, route cost, bucket key, and monthly key.
4. Check whether Autopilot already placed the tenant in cooldown.
5. Check the account-wide monthly quota.
6. Read the behavior classification and calculate the adaptive lane.
7. Check and potentially spend burst tokens.
8. Combine monthly and burst results into one verdict.
9. Record the decision in the audit log.
10. Send the same event to fingerprints, Autopilot, stats, memory, visitor tracking, and live transports.
11. Set rate-limit headers.
12. Return `429` for a block, or continue to the application/upstream.

The full flow is ready to import from [limitplane-request-flow.mmd](./limitplane-request-flow.mmd).

## Every implemented logical service

| Service/module | What it does | Input | Output/state | Runtime status |
| --- | --- | --- | --- | --- |
| `src/server.js` | Full demo gateway and HTTP route adapter | HTTP, WebSocket upgrades | Routes responses to control plane or data plane | Active full-demo entry |
| `bin/limitplane.js` | Reverse proxy for any upstream | HTTP | 429 or streamed upstream response | Active alternate entry |
| `src/index.js` | Public package surface | Imports | Exported gateway and algorithms | Active library entry |
| `limitPlane.js` | Coordinates identity, quota, per-IP adaptive burst, tenant aggregate burst, audit, and HTTP response | Request metadata | Scoped decision object / tenant+IP headers / 429 | Critical path |
| `policyEngine.js` | Converts identity and route into limiter instructions | API key, IP, route, policy | Key, capacity, refill, cost, quota | Critical path |
| `tokenBucketLimiter.js` | Controls short-term bursts | Tenant or tenant+IP key, capacity, refill, cost | Allowed and remaining | Used for tenant and per-IP guards |
| `monthlyQuotaLimiter.js` | Enforces calendar-month plan units | Monthly key, quota, cost | Used, remaining, reset | Default monthly meter |
| `auditLog.js` | Bounded decision diary | Decision facts | Recent events | Active event consumer |
| `automations.js` | Quota alerts, upgrade nudges, cooldowns, optional AI review | Decision events | Actions and ban state | Active |
| `fingerprint.js` | Classifies human, agent, crawler, retry bug | Recent request timing/routes | Adaptive lane | Active |
| `stats.js` | Totals, tenant cards, 60-second series | Decision events | Dashboard snapshot | Active |
| `wsHub.js` | Authenticated WebSocket handshake and broadcasts | Upgrade requests / events | Live dashboard frames | Active |
| SSE code in `server.js` | One-way live updates | Decision/stats events | EventSource frames | Active fallback/parallel transport |
| `userAgent.js` | Parses device, OS, browser | User-Agent header | Visitor metadata | Active |
| `jwt.js` | Login tokens and role guard | Credentials / bearer token | JWT claims or rejection | Active control-plane security |
| `orgStore.js` | Users, orgs, roles, site ownership | Admin/member operations | `.orgs.json` | Active local persistence |
| `stripeBilling.js` | Plans, checkout, signature verification, tier automation | Checkout requests / Stripe events | Tenant tier changes | Active; live when configured |
| `TenantStore` | Maintains API key → tenant/tier mapping | Billing/admin mutations | Shared tenant object + `.tenants.json` | Active |
| `aiExplainer.js` | Human-readable incident explanation | Automation + recent audit facts | AI or deterministic note | Active optional AI |
| `memoryStore.js` | From-scratch TF-IDF incident retrieval | Notable event text / query | Ranked documents + `.memory.jsonl` | Active |
| `tokenMeter.js` | Calls Groq and computes true token/dollar usage | Prompt | Completion and usage units | Active AI endpoint |
| Ops chat in `server.js` | Grounds Groq in live and historical state | User question | Answer + retrieved sources | Active when Groq configured |
| `nsfwStub.js` | Deterministic expensive-route demo | Text | Label/confidence | Active demo handler |
| Fixed/sliding/leaky algorithms | Alternative local limiter strategies | Key + algorithm parameters | Allow/block | Implemented library modules |
| Redis fixed-window modules | Distributed counters with Redis commands/Lua | Redis client + key/window | Allow/block | Implemented and tested separately |
| Redis IP runtime | Persists atomic buckets and expiring IP reputation across replicas/restarts | `REDIS_URL`, `IP_HASH_SECRET`, request decisions | Shared bucket/fingerprint/ban/strike state | Optional active runtime |

## Data ownership

### Shared runtime policy object

The `policy` object owns tiers, routes, and the tenant map. `PolicyEngine` reads it. `TenantStore` mutates the same tenant object. Admin tier changes also mutate the same tier objects.

This is why a Stripe webhook or admin action changes the next request immediately without restarting the server.

Tradeoff: this is simple and fast in one process, but multiple replicas would not share mutations. Production needs a database/config service plus versioned cache invalidation or pub/sub.

### Process-local state

In the default in-memory mode, the following disappears on restart and is different in every replica:

- token buckets;
- monthly meters;
- Autopilot bans and deduplication;
- audit events;
- stats;
- fingerprints;
- visitor map;
- SSE clients and WebSocket connections.

When Redis mode is enabled, token buckets plus HMAC-keyed IP fingerprints, bans, storms, and repeat strikes are shared and TTL-bounded. Monthly meters, audit, stats, visitor maps, and live connections remain process-local. At 100× scale, move durable business records to PostgreSQL and event history to a log/analytics store.

### Local file persistence

- `.tenants.json`: tenant identity and tier.
- `.orgs.json`: users, password hashes, organizations, roles, sites.
- `.memory.jsonl`: incident records used for retrieval.

These files are suitable for a local demo or one persistent server. They are not safe shared storage for horizontally scaled replicas because concurrent writes, durability, backups, and schema migration are not handled.

## Important architectural features to expand during an interview

### 1. Separate data plane and control plane

The data plane decides whether a request proceeds. It must be fast, deterministic, and available.

The control plane handles login, organizations, billing, tier changes, dashboards, and manual actions. Control operations are slower and less frequent.

Keeping billing and dashboard work out of the request hot path protects latency and availability.

### 2. Dual-meter rate limiting

LimitPlane asks two different questions:

- Monthly meter: “Has this customer consumed the plan they purchased?”
- Token bucket: “Is this customer sending traffic too quickly right now?”

A monthly allowance alone permits a destructive burst. A token bucket alone cannot enforce commercial plan usage. Both are required.

### 3. AI-aware weighted cost

Routes have cost classes: light 1, standard 2, heavy 5. This lets expensive AI work consume budget faster.

This is a simple deterministic model. A production version could price from measured CPU/GPU time or true model-token usage. The token-meter endpoint demonstrates post-call reconciliation when cost is only known after inference.

### 4. Deterministic-first Autopilot

Safety actions begin with inspectable rules:

- warn at 80% monthly usage;
- nudge after three monthly-cap hits;
- cooldown after a burst-block storm.

LLM explanation and review are optional and asynchronous. Permanent bans and financial actions should stay behind human approval. A strong rollout would start AI review in shadow mode and measure false positives.

### 5. In-process event fan-out

One decision event feeds audit, stats, behavior classification, Autopilot, memory, visitor tracking, and real-time UI updates.

This avoids recomputing request facts in each service. The tradeoff is tight in-process coupling. At scale, publish a versioned event to Kafka/Kinesis/SQS, use idempotent consumers, and keep the request decision independent of downstream consumer failures.

### 6. Immediate billing-to-policy loop

Stripe sends a signed webhook. Billing verifies the HMAC, updates TenantStore, and PolicyEngine sees the new tier on the next request because both share the same object.

The signature must be checked on the raw request body before JSON parsing. Otherwise a forged request could grant a free upgrade.

### 7. Real-time operator loop

Decision and Autopilot events are pushed to the dashboard through WebSocket and SSE. Admins can ban, unban, re-tier, and edit plan limits while the process runs.

WebSocket supports long-lived bidirectional transport; SSE provides a simpler one-way stream and browser reconnection behavior.

### 8. Two integration modes

- Middleware mode is simplest and fastest for Node applications.
- Reverse proxy mode works with any language and keeps blocked traffic away from the upstream.

The proxy streams request and response bodies instead of buffering them, which reduces memory pressure for large payloads.

### 9. Redis atomicity and the remaining production gap

The Redis token-bucket implementation atomically reads, refills, spends, writes, and refreshes TTL using one Lua script and Redis server time. A second Lua script atomically maintains IP storm windows, expiring bans, and repeat strikes. Older fixed-window Redis examples remain as separate teaching implementations.

Each script is atomic by itself, but the complete monthly → IP bucket → tenant bucket workflow is not one transaction. If an earlier guard spends and a later guard rejects, the earlier reservation remains spent. The next production evolution is a combined reserve/commit/rollback contract or one carefully designed Lua decision script.

## Three-minute HLD narration

> “A client reaches LimitPlane through the full Node server, the standalone reverse proxy, or embedded middleware. The request enters the data plane, where the policy engine maps the API key and route to a tenant, tier, cost class, bucket key, and monthly plan. Autopilot cooldown is checked first, then the monthly quota, adaptive behavior lane, and short-term token bucket. A blocked request receives 429 and never reaches expensive application logic; an allowed request continues to the demo handler or protected upstream.
>
> Every decision becomes one in-process event that updates the audit diary, statistics, fingerprints, Autopilot, incident memory, visitor tracking, and WebSocket/SSE dashboard. The control plane contains JWT/RBAC, organizations, admin actions, and Stripe billing. A verified Stripe webhook updates the shared tenant map, so the next request immediately uses the new tier.
>
> The demo persists tenants, organizations, and incident history in local JSON/JSONL files. Its default decision state remains in memory, but optional Redis mode shares Lua token buckets plus HMAC-keyed IP fingerprints, bans, storms, and strikes with bounded TTLs across replicas. Monthly usage, business data, and event history still need production-grade shared stores; the next limiter improvement is one atomic multi-guard reservation contract.”

## Likely HLD follow-ups

1. **What fails if the process restarts?** In default mode all decision state resets. In Redis mode buckets and IP reputation survive, while monthly counters, audit, stats, visitors, and live connections still reset.
2. **What happens with two replicas?** Default in-memory mode makes independent decisions. Redis mode shares bucket and IP reputation state, but other process-local meters and dashboards still diverge.
3. **What if Redis fails?** Decide fail-open or fail-closed per route; emit a degraded-mode metric and use a bounded local emergency limiter.
4. **How do you prevent hot keys?** Use tenant/route partitioning, Redis Cluster hash strategy, local token leasing, and sharded policies.
5. **How do you handle dynamic URL IDs?** Normalize routes to templates before constructing keys.
6. **How do you stop false AI bans?** Candidate gating, temporary cooldowns, duration clamps, auditability, shadow mode, false-positive metrics, and human approval for permanent action.
7. **Where does the database connect?** The current demo uses local files; PostgreSQL is a production replacement for tenants, users, organizations, plans, and durable audit metadata.
8. **Why are billing routes outside the limiter?** A blocked customer must still be able to view plans and pay; locking the upgrade path would trap them.
