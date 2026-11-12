# Day 4 proof: a protected public-beta deployment

**Slide 40 summary.** Daily Social Spark now runs on Vercel behind four layers of spending protection: usage limits enforced by the app, a $30 cap on the Anthropic workspace, a $100 cap on the organization, and no payment method on file. We rolled it out in four stages, each proving one safeguard before the next was switched on. Only the last stage cost money: one live scan, about $0.47, which the usage ledger accounted for exactly.

## 1. Staged rollout (protected Vercel Preview, 2026-11-12)

| Stage | What was switched on | What it proved | Paid calls |
|---|---|---|---|
| A | Nothing (free demo engine) | The app builds and runs on Vercel. Visitors not signed in to Vercel are redirected to login, including on both paid routes. | 0 |
| B | Paid engine and key, but **no usage storage** | **Fails closed:** both paid routes refuse with "usage tracking unavailable" in about 50 ms. Vercel's IP header is present. | 0 |
| C | Real Upstash, with a **$0.01 budget** and a test namespace | Vercel reads and writes the real database. Every paid request is refused at the budget check, including three sent at once. Nothing was counted or charged. | 0 |
| D | **The real $27 budget**, live namespace | One end-to-end live scan, recorded correctly | 1 scan |

## 2. The live scan (Stage D)

- **Brief:** Glossier on TikTok, the same as the Day 3 baseline, run through the normal page.
- **Workflow:**
  - Request 1, research: the Scout searches the web, then files what it found into a signed evidence ledger.
  - Request 2, creative: the Generator writes 3 ideas, the Evaluator scores them, the code ranks them, and the Editor proposes one revision, which is rescored.
- **Calls:** 6 to `claude-sonnet-5-5` (2 research, 4 creative) and 5 web searches. No retries.
- **Duration:** both requests finished within 162 seconds. The exact end time wasn't captured. That's within Vercel's 300-second limit per request.
- **Cost, as recorded by the app:** $0.4737 (creative about $0.15; research about $0.32, including $0.05 for searches). This is calculated from token counts reported by Anthropic multiplied by list prices.
- **Result:**
  - The idea: "Can't always be the viral serum, someone's gotta hold it down."
  - Labeled an *unverified creative hypothesis*: the research ran and checked out, but no source showed a dated, growing trend.
  - A "32 million views" figure was flagged as unverifiable rather than presented.
  - The editor's revision scored lower (85 against 93), so the code kept the original.

## 3. Usage accounting (Upstash, live namespace `dss:usage:v1`)

| | Before | During | After |
|---|---|---|---|
| Held against budget | $0 | $0.80 research + $0.60 creative | $0 (released) |
| Spent this cycle | $0.00 | $0.00 | $0.4737 (measured, not the hold) |
| Tester allowance | 3 of 3 | — | 2 of 3 |
| Leftover lock | — | — | None |

## 4. Screenshots (page content only, with no URLs or credentials)

- `stage-b-fail-closed-mobile.jpg`: the "live scans paused" card on a phone (Stage B).
- `stage-c-budget-refusal-mobile.jpg`: the "beta budget reached" card, with the reset shown in local time (Stage C).
- `stage-d-progress-desktop.jpg`: the live scan in progress, request 1 of 2.
- `stage-d-result-desktop.jpg` and `stage-d-result-mobile-before-fix.jpg`: the live result.
- `fix-mobile-sash-and-allowance-mock.jpg` and `fix-desktop-allowance-mock.jpg`: the presentation fixes, shown with mock data.

## 5. Not independently verified

- **The Anthropic Console bill** for the Public Beta workspace. The app's $0.4737 is an estimate; Console confirmation is still needed.
- **The exact $27 budget and the 6-per-network limit on Vercel.** The app doesn't display these values. The status confirmed the budget isn't the $0.01 test value, and the network limit was proven in a local Vercel simulation.
- **Whether Anthropic bills a call that's canceled partway.** Not documented, so the app charges the full hold.

## 6. Leadership reflection (draft)

We treated spending like a production budget, with more than one signature required. The app holds a worst-case amount before any paid call, then swaps the hold for the measured cost. Anthropic's workspace and organization caps, and having no payment method on file, sit behind it as independent backstops. The app's limit is $27, a little under the $30 workspace cap, so visitors meet our friendly message long before Anthropic's hard stop.

We chose to **fail closed**. If the app can't count spending, it refuses paid work. A paused beta is an inconvenience; an uncounted bill is a breach of trust.

We **staged the rollout** the way you'd tech a show before opening night: lights, then sound, then a full dress rehearsal. Each stage proved one safeguard on the real platform before the next was switched on. Three of the four stages cost nothing, and the one paid test was planned, capped and accounted for.

We were candid about trade-offs. Limits apply per browser, not per person, so the shared budget is the only firm cap. Creative quality issues, such as thin evidence and dense output, were logged for a later sprint rather than allowed to delay a safe rollout.

## 7. Beta access: a Shareable Link vs. a public Production site

| | Shareable Link to the protected Preview | Public Production |
|---|---|---|
| Inviting testers | Send one link | Send one URL |
| Revoking access | Turn the link off in Vercel. People who already opened it may keep access through a cookie (unconfirmed) | Re-enable protection, or switch the engine to demo |
| If the link is forwarded | Anyone holding it gets in, anonymously | Anyone on the internet can reach it |
| Usage protections | Apply fully. Every scan still passes our limits | Apply fully |
| Plan limits | Hobby allows **one** shareable link per account | Standard Protection; no Hobby restriction found |
| What it shows | The latest deployment of the branch (as documented) | The latest deployment of `main` |
| Setup needed | None: no merge, no Production settings | Merge to `main`, add Production settings, deploy |

**Recommendation:** use the **Shareable Link** for the 10–15-person beta.
- It keeps everything else behind Vercel login, needs no merge or Production deployment, and can be turned off.
- Our limits protect spending either way.
- Before sending it out, open it once in a private window to confirm the page and the status check work. This is free.
- **Kill switch:** turn off the link, or set the budget to `0.01` and redeploy.

## 8. Issue triage

**Before inviting testers**
1. Confirm the $0.47 charge in the Anthropic Console.
2. Push today's presentation fixes, so the Preview redeploys.
3. Create and test the Shareable Link (free).
4. Send testers a short note: these are creative hypotheses, "unverified" means unconfirmed rather than wrong, there are 3 scans a day, and here is how to give feedback.

**Disclose during the beta** (the interface already labels each of these)
- Most evidence comes back unverified.
- Some ideas aren't grounded in any researched signal.
- Scores are AI judgments and provisional; they may run high.
- The results are long on phones.
- Limits apply per browser.

**Later sprint**
- Evidence quality: research depth and dated sources.
- Requiring all three ideas to be grounded in research.
- Calibrating the evaluator against human ratings.
- A simpler, more mobile-friendly results screen.
- Brand-input validation. This must be fixed before any public Production launch.
