# Performance audit — 24 October 2026

## Findings and fixes

| Finding | Change |
| --- | --- |
| Android root re-rendered every second across every tab, even without an active timer | Tick only for active focus on visible Today/Focus, stop behind sheets and in background |
| Four mobile refresh endpoints ran in two serial phases | Start all four concurrently; retain revision/sequence safeguards |
| Background resume, network and interval triggers could overlap | Deduplicate background loads |
| Web bootstrap serialized independent database reads | Run independent reads concurrently through the existing bounded connection pool |
| Project messages required manual refresh | Visible conversations refresh every 10 seconds; one polling request at a time |

PostgreSQL pools were already reused as singletons. No connection-cache changes were needed. No production database contents or user documents were changed for testing.

## Measurements

Compiled local server, fictional disposable PostgreSQL workspace, four samples per authenticated endpoint. Warm medians: mobile bootstrap 4 ms / 10,479 bytes; web bootstrap 5 ms / 20,818 bytes; focus 2 ms; scheduling 3 ms; task history 2 ms / 8,267 bytes. These are small-fixture checks, not production load or mobile-network benchmarks. Full logs and JSON are ignored local artifacts in `.data/product-audit/response-times.json`.

One unauthenticated production homepage request returned HTTP 200, 0.485 s TTFB / 0.525 s total. No signed-in production latency claim is supported by that request.

## Remaining scale work

- Workspace bootstrap returns entire task/CRM collections. Add scoped server pagination without breaking shared views and totals.
- Task queries contain correlated relationship/recurrence lookups. Measure EXPLAIN plans with representative large fixtures before altering joins/indexes.
- Lists need viewport virtualization for thousands of cards; bounded containers currently limit height, not mounted row count.
- Project conversation is capped at 100 comments; add cursor pagination before presenting it as a full chat replacement.
- Add production endpoint telemetry (p50/p95, query count, payload bytes) before selecting hosting/database upgrades.
- Physical Android performance on slower hardware and mobile networks remains unverified.
