# Public beta protections

These rules keep Daily Social Spark affordable while it's open to the public. They cover both paid requests, `/api/research` and `/api/scan`.

## The rules

| Rule | Setting | Default |
|---|---|---|
| Paid scan attempts per browser per day | `SPARK_DAILY_SCANS` | 3 |
| Paid scan attempts per network (IP address) per day | `SPARK_NETWORK_DAILY_SCANS` | 6 |
| Shared public budget per credit cycle, in USD | `SPARK_PUBLIC_BUDGET_USD` | 27 (under the $30 Anthropic workspace cap) |
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
| `redis` | Public deployment. Needs `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_URL` + `KV_REST_API_TOKEN` pair that Vercel's integration adds; the KV pair wins if both are set). | Required |
| `memory` | Local trials and tests. Single process only. | Refused |
| `off` | Your own local use: no limits, nothing recorded. | Refused |
| *(unset)* | Same as `off` locally. On Vercel, paid scans are refused. | Refused |

Keys live under `dss:usage:v1:` by default. `SPARK_USAGE_KEY_PREFIX` changes the prefix; tests use their own (`dss-test:…`), so they never touch live records.

## What it does not guarantee

- **Per browser, not per person.** Visitors are identified by an anonymous cookie. Clearing cookies, a private window or another browser gets a fresh daily allowance. The per-network limit slows that down, but people on the same office or home network share it, and a phone hotspot or VPN gets around it. Only the shared budget is a firm cap.
- **This budget is the app's own estimate, not Anthropic's bill.** It can drift from the actual bill: token counts are exact, but prices are hard-coded, and canceled calls are estimated. It doesn't see API usage outside this app. Use an Anthropic workspace spend limit as the provider-level backstop.
- **Cycle dates are approximate.** The app's budget cycle starts at 00:00 UTC on the reset day. Plan credits refresh on your billing date, and workspace spend limits reset on the 1st of the calendar month (UTC). These dates may not line up.
- **Built for beta scale.** All usage lives in one small record, which suits tens of visitors, not thousands.

## Deploying to Vercel

### Budget reset day: the 13th

Anthropic shows the next API credit on the 12th but not the time, so a reset at 00:00 UTC on the 12th could come before the credit arrives. The app resets on the **13th** instead (`SPARK_BUDGET_RESET_DAY=13`), at least a day after the credit should have arrived. That means a fresh $27 is never opened before the credit it relies on.

The trade-off is a one-day lag. On the 12th, visitors are still spending the previous cycle's leftover budget. With no payment method and auto-reload off, no spending can turn into a charge: when credits run out, Anthropic simply refuses the calls.

### Environment variables

Enter these in Vercel → Project → Settings → Environment Variables. Mark the secrets as **Sensitive**, so their values can't be read back later.

| Variable | Value | Sensitive |
|---|---|---|
| `ANTHROPIC_API_KEY` | The **Public Beta workspace** key (never your personal key) | Yes |
| `SPARK_LEDGER_SECRET` | A new random value, not your local one (see below) | Yes |
| `UPSTASH_REDIS_REST_URL` | From the Upstash database's REST API section | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | The standard token (not read-only) | Yes |
| `SPARK_ENGINE` | `claude` | No |
| `SPARK_RESEARCH` | `live` | No |
| `SPARK_USAGE_STORE` | `redis` | No |
| `SPARK_PUBLIC_BUDGET_USD` | `27` | No |
| `SPARK_BUDGET_RESET_DAY` | `13` | No |
| `SPARK_DAILY_SCANS` | `3` | No |
| `SPARK_NETWORK_DAILY_SCANS` | `6` | No |

**Leave these unset:**
- `SPARK_USAGE_KEY_PREFIX`, except during the staged checks below
- `SPARK_SCAN_BUDGET_MS`, which is only for tests
- `ANTHROPIC_BASE_URL`

**To create the ledger secret** without it appearing on screen, run this in your own Terminal app:

```bash
openssl rand -base64 48 | pbcopy
```

It copies straight to your clipboard; paste it into Vercel.

**Preview and Production use the same values.** Both spend from the same Anthropic workspace, so they share one Upstash database and one $27 budget. Giving Preview its own budget would quietly raise the public ceiling.

### Staged rollout (no paid calls until stage D)

| Stage | Preview settings | What it proves |
|---|---|---|
| A | None | The build deploys and the demo engine works |
| B | Engine, research, API key, ledger secret, `SPARK_USAGE_STORE`, with no Upstash yet | Fails closed: both paid routes return 503 |
| C | Add Upstash, plus `SPARK_USAGE_KEY_PREFIX=dss-test:preview` and `SPARK_PUBLIC_BUDGET_USD=0.01` | Real storage works on Vercel; every scan is refused before any paid call. The status reply at `/api/scan` shows `"network":"identified"` |
| D | Remove the prefix, set the budget to `27`, and redeploy | One approved paid scan |

Production gets the full settings only after stage D passes. Until then, a Production deployment with no settings runs the free demo engine.

## Roadmap: other audit findings (not started)

1. Weak evidence verification. Most evidence ends up unverified (undated quotes, sources that are mostly trend roundups).
2. The results screen is too dense: 10 sections and several overlapping scores.
3. Mobile readability: a long scroll, and the slate bar wraps on phones.
4. Limited brand-input validation: only the length is checked, and the text goes straight into every prompt.
