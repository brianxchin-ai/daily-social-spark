# Public beta protections

These rules keep Daily Social Spark affordable while it's open to the public. They cover both paid requests, `/api/research` and `/api/scan`.

## The rules

| Rule | Setting | Default |
|---|---|---|
| Paid scan attempts per browser per day | `SPARK_DAILY_SCANS` | 3 |
| Paid scan attempts per network (IP address) per day | `SPARK_NETWORK_DAILY_SCANS` | 6 |
| Shared public budget per credit cycle, in USD | `SPARK_PUBLIC_BUDGET_USD` | 30 |
| Day of the month the budget cycle resets (1–28) | `SPARK_BUDGET_RESET_DAY` | 1 |
| Scans running at once, per browser | fixed | 1 |

**When things reset**
- Daily allowances reset at 00:00 UTC. The page shows that time in each visitor's own time zone.
- The budget resets at 00:00 UTC on the reset day.

**How attempts are counted**
- An attempt is one scan: research, then creative. It counts as soon as it starts, whether it succeeds, fails or is canceled.
- When an attempt is refused before any paid call, nothing is counted or charged.

**Which limit applies first.** The shared budget always comes first. If it's used up, nobody can scan, even with allowance left.

## How it works

**Holds and charges**
- Before any paid call, the worst-case cost of the attempt is put on hold against the shared budget: $0.80 for research and $0.60 for creative.
- A new attempt can start only if the budget can cover it, counting both money already spent and everyone else's holds.
- When each phase ends, its hold is replaced by its measured cost. Cost is priced by the model that actually answered; a model the app doesn't recognize is priced deliberately high.
- If a call ends without a readable response (a cancel, timeout or dropped connection), the phase is charged its **full hold**, because it may have been billed anyway.
- If a request dies and never reports back, its hold expires after 6 minutes and is charged in full.

**One handoff per scan.** Each research handoff is signed and tied to its attempt, so it can feed exactly one creative request. Replaying it, or using it from another browser, is refused before any paid call.

**One change at a time.** Usage is stored in Upstash Redis and shared by every server instance. The server applies one change at a time, so two scans starting at the same moment can't both slip under the budget.

**If storage is down.** If the store can't be reached, or a setting is invalid, paid scans are refused with a clear message. The app never runs paid work without being able to count it.

## Storage modes (`SPARK_USAGE_STORE`)

| Value | Use | On Vercel |
|---|---|---|
| `redis` | Public deployment. Needs `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`). | Required |
| `memory` | Local trials and tests. Single process only. | Refused |
| `off` | Your own local use: no limits, nothing recorded. | Refused |
| *(unset)* | Same as `off` locally. On Vercel, paid scans are refused. | Refused |

## What it does not guarantee

- **Per browser, not per person.** Visitors are identified by an anonymous cookie. Clearing cookies, a private window or another browser gets a fresh daily allowance. The per-network limit slows that down, but people on the same office or home network share it, and a phone hotspot or VPN gets around it. Only the shared budget is a firm cap.
- **This budget is the app's own estimate, not Anthropic's bill.** It can drift from the actual bill: token counts are exact, but prices are hard-coded, and canceled calls are estimated. It doesn't see API usage outside this app. Use an Anthropic workspace spend limit as the provider-level backstop.
- **Cycle dates are approximate.** The app's budget cycle starts at 00:00 UTC on the reset day. Plan credits refresh on your billing date, and workspace spend limits reset on the 1st of the calendar month (UTC). These dates may not line up.
- **Built for beta scale.** All usage lives in one small record, which suits tens of visitors, not thousands.

## Roadmap: other audit findings (not started)

1. Weak evidence verification. Most evidence ends up unverified (undated quotes, sources that are mostly trend roundups).
2. The results screen is too dense: 10 sections and several overlapping scores.
3. Mobile readability: a long scroll, and the slate bar wraps on phones.
4. Limited brand-input validation: only the length is checked, and the text goes straight into every prompt.
