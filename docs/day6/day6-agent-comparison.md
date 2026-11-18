# Day 6: Fixed workflow vs. an autonomous agent

**Summary.** On 2026-11-18 we built a second engine for Daily Social Spark on the local branch `day6-agent-mode`.

- **The experiment.** Instead of a production schedule written in code (Scout → Generator → Evaluator → Editor), one AI "creative director" chooses its own next move with a toolkit: search, read a source, file evidence, write ideas, develop, send for review, revise, finish. Code keeps the money, the clock, the scoring and the honesty rules.
- **Six briefs, three each.** In a blind side-by-side on three briefs, the agent produced the idea we preferred on two of the three. It ran about twice as fast at half the cost.
- **It didn't use its freedom.** It took the same short path every time, did less research than the fixed workflow, and never dug deeper, revised or changed course.
- **The finding.** The architecture delivered efficiency, not deliberation.

**Update, later the same day.** After the comparison we ran six rounds of changes to get the agent to use its freedom (section 7):
- **Required steps produced compliance.**
  - A benchmark brought benchmark-sized research.
  - A "settle your hypotheses" rule brought settling, often as end-of-run paperwork.
- **Optional tools went unused.** That included a cheap "gut-check" for testing many ideas: never used once.
- **Removing every quota didn't create exploration either.** The agent then wrote one or two ideas, reviewed them once and finished.
- **Real judgment appeared in the small choices:**
  - corroborating a single-source signal
  - reading a page for a reason
  - candid verdicts on its own bets and comparisons
- **Its comparisons show it does weigh alternatives,** in its head rather than on the idea wall.
- **Its natural style is evidence-led convergence:** form a view, research it, write the idea the evidence supports, test it once, finish.
- **Two engineering fixes made runs reliable:**
  - a budget reserve so a scan can always afford its review
  - a simpler evidence form

All figures below are the app's own estimates (Anthropic's reported token counts × list prices). Everything ran locally, nothing was deployed, and the friends' beta was untouched.

## 1. What we built

| Part | Role (production analogy) | Who decides |
|---|---|---|
| The agent (Claude Sonnet 5.5) | Creative director: picks every next action and states why | The AI |
| Toolkit (11 tools) | Research desk, evidence board, idea wall, review panel | The AI chooses; code runs them |
| Governor | Line producer: prices every paid call's worst case before it runs; refuses anything that would pass **$0.75 per scan**; wrap-up at $0.55 or 200 s; hard stop at 270 s, 24 turns, 40 tool calls | Code |
| Review panel | The same blind evaluator as the fixed workflow (ideas anonymized and shuffled) | A separate AI call; the agent never scores itself |
| Scoring and rules | Day 5 rubric, ranking, fresh-trend head start, rejections, revision rule | Code |
| Trace | A log of every action, the agent's stated reason (quoted, never its hidden reasoning) and what code found | Code |

The agent sees the same result page as the fixed workflow, plus a live action feed while it works and an agent trace in the "How we got here" drawer.

**Free testing before any paid run:**
- 310 automated tests.
- Simulated runs with a rule-based stand-in for the AI.
- A copy of the app with no API key, talking to a fake Anthropic API.

## 2. Development runs: what the real AI exposed

Each real run (Keurig on Instagram Reels unless noted) surfaced something the simulations couldn't.

| Run | Outcome | Cost | What we learned | Fix |
|---|---|---|---|---|
| Two runs in your own browser | Finished, about 60 s each | $0.22, $0.24 | It worked, cheaper than the $0.45–0.70 estimate (prompt caching re-reads earlier turns at 5% of the price) | none needed |
| 1 | Finished, winner 70 | $0.26 | **Shortest possible path**: never checked its evidence, terse reasons ("Develop L3."). Its signals were rejected once for arriving as text | Unpack text input; correct the "independent sources" count; agent wording on the page |
| 2 | Stopped, no idea | $0.16 | My "three bad calls in a row" rule counted three parallel calls in one turn, so the agent never saw an error | Count strikes per turn; ask for `why` first, and accept work missing it (flagged) |
| 3 | Finished, winner 69 | $0.20 | Filing evidence kept failing, so the agent pivoted on its own: *"Signal filing keeps failing, so I'm building original-format ideas."* | Simpler evidence form (only what honesty depends on is required); clearer error messages |
| 4 | Finished, winner 65 | $0.29 | Evidence filed first try. The agent made a smart fix to a rejected trend idea, but our +5-point revision rule blocked it | **Approved rule change:** a revision that clears a rejection is kept if it doesn't lower the score |

Between runs 1 and 2 we also added **nudges, not mandates**:
- Code's readout now shows evidence quality.
- The instructions state the evidence bar.
- After a review, the agent sees the leader's weak spots.
- `finish` requires a stated revision decision.
- Stated reasons must name the evidence.

## 3. The comparison

**Method.** Three briefs chosen to test different situations, none of them Keurig (the brief we'd tuned on).

| # | Brief | Tests |
|---|---|---|
| 1 | Glossier · TikTok · no audience | Trend-rich category |
| 2 | "local hardware store" · Facebook · no audience | Thin evidence |
| 3 | Liquid Death · YouTube Shorts · "College students who treat academic achievements like video games" | Brand voice plus audience |

**Fairness controls:**
- Same model (Claude Sonnet 5.5) and same day for both engines.
- No retries.
- The no-repeat memory was cleared before every run, so neither engine was steered away from the other's ideas.
- The engine that went first alternated across briefs.
- Every result was captured exactly as the server sent it.

**Measured results.** Six of six runs completed.

| | Glossier fixed | Glossier agent | Hardware fixed | Hardware agent | Liquid Death fixed | Liquid Death agent |
|---|---|---|---|---|---|---|
| Time | 161 s | 68 s | 144 s | 77 s | 145 s | 67 s |
| Cost | $0.537 | $0.247 | $0.506 | $0.255 | $0.501 | $0.234 |
| Web searches | 5 | 2 | 5 | 2 | 5 | 2 |
| Signals (fresh) | 7 (6) | 2 (2) | 8 (6) | 2 (2) | 6 (4) | 1 (0) |
| Sources behind the winning idea | 4 | 2 | 4 | 1 | 3 | 2 |
| Winner type | fresh trend | fresh trend | fresh trend | fresh trend | fresh trend | original format |
| Spark Score | 65 | 78 | 74 | 65 | 68 | 74 |
| Revision | tried, kept original | none | tried, kept original | none | tried, kept original | none |

**Averages:**
- **Fixed workflow:** about 150 s and $0.51 per scan.
- **Agent:** about 70 s and $0.25 per scan.

**The agent's path was identical on all three briefs:** two searches → file evidence → longlist → shortlist → develop three → review → finish. It read zero pages, changed course zero times and made zero revisions. Its revision decisions were reasoned, though. On the hardware brief it said: *"I can't fix the evidence gap without more research."* It finished anyway, with more than half its budget left.

## 4. Blind review

The two winners per brief were shown unlabeled, in shuffled order, with scores and sources hidden.

| Brief | Preferred idea | Engine | Why (paraphrased) |
|---|---|---|---|
| Glossier | "Your skin has code rot. Here's the patch." | **Fixed** | Easier to make authentically and at scale; the "first Glossier then and now" idea taps the 2013-vs-2026 conversation but needs years-old product and photos |
| Hardware store | "A random Tuesday at the hardware store, told in questions" | **Agent** | Invites real stories and cultural insight; humor from everyday specificity. The "DIY rage" alternative leans on hyperbole that stretches consumer truth |
| Liquid Death | "Fight your final exam like a boss with a real HP bar" | **Agent** | The can works as an inventory item that restores health to win the boss fight, a more satisfying product role |

**Agent 2, fixed 1.** The Spark Score's top pick matched the blind pick on 1 of 3 briefs.

This is two different signals, not a flaw in the rubric. The Day 5 rubric stands as designed: it scores ideas against fixed criteria, while the blind pick is a creative director's holistic judgment of what will win algorithmically and culturally. The reasons given are attributes of these particular ideas, not new criteria; a harder-to-make, more culturally primed idea could win next time. Three briefs can't show whether the two signals systematically diverge. The Spark Score remains what the app labels it: a hypothesis.

## 5. What we learned

1. **Freedom to deliberate doesn't make an agent deliberate.**
   - Given a toolkit and no fixed order, the agent settled on the fastest route and repeated it.
   - Nudges improved its *explanations* far more than its *behavior*.
   - Agents optimize for finishing unless their environment makes looking closer clearly worth it.
2. **Tool design mattered more than instructions.** Three of the four development fixes were about how tools accept input (text-formatted fields, an overloaded evidence form, a too-strict error rule), not about what the agent was told. When a tool was awkward, the agent routed around it, even abandoning research.
3. **Rules written for one workflow can misfire in another.** The +5-point revision rule made sense for an editor polishing an idea that already passed. It blocked the agent's correct fix to a rejected idea.
4. **The guardrails held.**
   - No agent run came close to its $0.75 ceiling; the highest was about $0.29. (The fixed workflow has no per-scan ceiling of its own; its runs cost about $0.50 each.)
   - No source was invented: every link traces to a real search result.
   - Every stop was clean and labeled, and nothing was retried.
5. **The real win was efficiency.** Half the cost and half the time, with ideas that held up in blind review. Running in about 70 seconds also answers the plan's deployment worry: an agent scan fits comfortably inside Vercel's 300-second limit on the free plan, in a single request.
6. **Thinner research didn't cost quality here.** The preferred ideas leaned on everyday truths more than on trends, which may be why. That's likely to vary by brief.

## 6. Caveats

- Three briefs, one judge: a strong hint, not proof.
- Both engines use the same model and the same review panel, so differences come from process, not intelligence.
- Costs are the app's estimates, not Anthropic's invoice.

## 7. After the comparison: getting the agent to use its freedom

**Direction set after the comparison:**
- Cost isn't the deciding factor.
- The agent should actually use the tools and methods it's free to use.
- No larger blind review for now.

Each round below changed only the agent's environment (instructions, tools, budget rules), never the rubric, then ran the same three briefs on the agent alone, with the no-repeat memory cleared before each run.

| Round | What changed | Searches / page reads / revisions per scan | Time · cost per scan | What happened |
|---|---|---|---|---|
| 0 (comparison) | n/a | 2 / 0 / 0 | ~70 s · ~$0.25 | The same short path on every brief |
| 1 | Stated what the work is judged on; framed budget and time as "a budget to invest, not a target to undercut"; added a benchmark ("4 to 8 searches, at least one primary source…"); raised the agent's thinking effort | 4 / 1 / 1 | ~125 s · ~$0.48 | Corroboration searches and purposeful reading. But every run matched the benchmark almost exactly |
| 2 | Removed the benchmark; added working hypotheses (record bets, settle them with evidence code checks); flagged weak finalists as candidates to replace | Glossier 6 / 3 / 0; the others 3–4 / 0 / 0 | ~115 s · ~$0.46 | Paths finally differed by brief. **Glossier researched deeply, then couldn't afford its review: no idea, $0.63 spent.** Hypotheses recorded but never settled |
| Fixes | A finishing reserve; a realistic review-cost estimate; `finish` requires every hypothesis settled | 4 / 0 / 0 | ~107 s · ~$0.41 | All three finished. Bets settled candidly, but in 2 of 3 runs only after the review. Evidence filing failed on the hardware brief |
| Filing fix | Signals filed as flat fields instead of one nested block | 3 / 2 / 0 (one run) | 104 s · $0.43 | 4 of 4 signals filed first try; 2 page reads; all hypotheses settled before writing ideas |
| Open shape | Removed the quota. A scan needs only one reviewed idea, settled hypotheses, and a stated comparison of what else it considered. Reviews take 1–3 ideas, and code ranks everything reviewed | 2–5 / 0–1 / 0–1 (none kept) | ~94 s · ~$0.39 | Ideas noted: 2, 2, 1. One review per scan. Never returned for a better idea after scores. Winners scored 85, 68, 70 |
| Gut-check | Added a cheap first read (stop power, shareability, one-line note) on up to 10 noted ideas. Never counts toward the score | 2–3 / 0–1 / 0–1 (one kept) | ~86 s · ~$0.31 | **The gut-check was never used.** Ideas noted: 1, 2, 2. One review per scan. Winners scored 70, 71, 78 |
| Routes | Goal reset to organic views. Three routes: proven (documented and performing; evidence within 90 days), primed (fresh and showing signs of breaking) and original. Every route ranked on the Spark Score alone, with no head start. Each developed idea names its route and a reach thesis. Approved scoring changes. Four briefs, adding Duolingo · TikTok | 3–4 / 0–2 / 0 | ~92 s · ~$0.40 | Routes discerned with evidence-based reasons: proven, original, primed, proven. Still one idea reviewed per scan. Winners scored 70, 68, 75, 70 |
| Range | Range as a payoff, not a quota (the one-idea minimum stays). The status update shows how contested the lead is ("unchallenged," or the runner-up's gap) and what one more idea costs in a review (a few cents). A finish with a single reviewed idea is challenged once and accepted the second time. The instructions present range as how code proves an idea is the best | 4 / 0–1 / 0–1 (one kept) | ~103 s · ~$0.43 | **Every scan put two genuinely different ideas in front of the panel, side by side.** The challenge never had to fire. Winners 74, 75, 73 against runners-up 61, 63 and a rejected 65 |

**Notable moments, in the agent's own stated reasons:**
- *"G1 rests on one source; seeking a second independent one."* (Round 1, Liquid Death)
- *"It's the only dated Facebook-specific trend; need to see the mechanic before deciding if it's usable."* (Round 1, hardware store)
- *"Refuted H3: Panel scored the nostalgia idea 2/5 on cultural relevance, and my research found nothing live tying it to current behavior."* (Fixes round, Glossier)
- *"Dropped H2: Search returned only tool-identifier apps, not Facebook engagement evidence, so the bet is untested."* (Fixes round, hardware store)
- *"Its main caveat is that the trend evidence is thin: one source, dated only by a page update."* (Open shape, Glossier, explaining its own winner)
- *"I considered cloud skin, ectoin and relatable hair hooks, but their evidence was older or hashtag-count based and less tied to Glossier."* (Gut-check round, Glossier: alternatives weighed but never written down)
- *"Develop L1 as a contrasting original so the panel can compare two mechanics."* (Gut-check round, Liquid Death)
- *"The hose idea won on shareability (5 vs 3) and stop power (4 vs 3). The mystery game was stronger on participation but weaker on motion and send-worthiness."* (Range round, hardware store: the comparison now rests on scores, not on ideas it only thought about)

**What the rounds taught:**
1. **Agents follow the brief they're given, sometimes too literally.**
   - Framing works: Round 1 doubled research depth.
   - But each nudge produced behavior shaped like its own wording. With the benchmark removed, depth fell back on two of three briefs.
   - With a "settle before finishing" rule, settling became paperwork.
2. **A budget rule has to protect the finish, not just the ceiling.** Without a reserve, a curious agent spent its money on research and couldn't afford the one step every scan needs. The fix belongs in code, not in the instructions.
3. **Tool design keeps deciding outcomes.** The nested evidence form failed in four separate runs. Flattening it fixed filing on the next real run.
4. **Real discretion lives in the small choices.** Which lead to chase, when to corroborate, what to read and how honestly to judge its own bets all varied and were well reasoned.
5. **Required steps get compliance; optional tools get ignored.**
   - With a quota, the agent filled it.
   - Without one, it did the minimum that was credible: one or two ideas, one review.
   - A cheap tool for testing many ideas went unused in every run, and so did the second review round. In the last six runs, page reading appeared in half and revision attempts in four.
   - The agent uses what moves it toward a finished scan, not what a creative director would value for its own sake.
6. **It weighs alternatives in its head, not on the page.** Its comparisons name directions it considered and rejected from the evidence without ever writing them down. The exploration is partly real, but invisible to the trace.
7. **Its natural working style is evidence-led convergence,** and it's efficient. With the open shape: about 85–95 seconds and $0.31–0.39 per scan, winners scoring 68–85, and comparisons candid about thin evidence.

**Conclusion of the experiment.** Giving the agent freedom over its process didn't make it explore. Requiring exploration made it comply. The levers that did change behavior were the ones that changed the agent's environment:
- what it's judged on
- what it can see (the evidence-quality readout)
- what the rules make worthwhile (the reserve, the revision exception)

Instructions alone did much less. Getting creative exploration from an agent would take giving exploration a payoff it can see on the way to finishing, not more freedom or more rules.

**The routes and range rounds (after the conclusion above).**
- **Routes.** The agent discerned its route well. It picked a proven pattern twice, a primed signal once and an original format once, each for an evidence-based reason. In your blind read it won 1 of 3 against the previous round (Liquid Death's primed GTA idea), and Duolingo rated 4/5. But it still bet on one idea per scan.
- **Range.** Exactly the "payoff it can see" the conclusion called for. Once the status update showed an unchallenged lead as a guess and priced a contender at a few cents, all three scans developed two distinct ideas and had them reviewed together. Comparisons now cite the panel's scores for both ideas instead of directions the agent only considered. With three runs, we can't tell whether the status update or the instructions did more. The one-time challenge was never needed.
- **Blind read: range round vs routes round (the user's picks).** The range round won 2 of 3:
  - Glossier: range (reveal-first rewind to the meltdown face). *"Transformation videos are psychologically satisfying and proven to work."*
  - Hardware store: range (hose as a mic). *"A good hook of straight-to-camera delivery… can remind people of their own stories."*
  - Liquid Death: routes round (the primed GTA VI wanted level), which also won its earlier blind read. *"One of the highest trending topics in entertainment and culture today."* The copy may need to be made generic so it doesn't name GTA. The range run lost a primed bet here, steered by the out-of-date evidence warning fixed afterward.
  - For the first time, the Spark Score agreed with every pick: 74 vs 70, 75 vs 68 and 75 vs 73.
- **Two fixes the range runs exposed:**
  - The evidence check still told the agent that no fresh signal meant any trend idea would be rejected. That predates the proven route and steered the Liquid Death run toward an original format. Each signal is now labeled with the routes it can carry.
  - A revision that switched a proven idea to an original format kept its "proven" label. A revision now takes the route its basis implies.

**Engine as of the last commit (ad75145):**
- **Shape:** open, requiring one reviewed idea, settled hypotheses, a stated comparison and a route decision. Reviews take 1–3 ideas, up to 4 per scan. A lone reviewed idea is challenged once before finishing.
- **Routes:** proven, primed or original, ranked on the Spark Score alone. Each developed idea carries a reach thesis.
- **Tools:**
  - search and page reading
  - flat evidence filing
  - hypotheses
  - the idea wall
  - the gut-check
  - develop, review and revise
- **Budget:** the $0.75 ceiling with the finishing reserve and a realistic review estimate.
- **Instructions:** the outcome and the options, with no counts or suggested order.

## 8. Spending (2026-11-18, local runs on the user's key)

| | Runs | Estimated cost |
|---|---|---|
| Agent development runs | 6 | $1.38 |
| Comparison: fixed workflow | 3 | $1.54 |
| Comparison: agent | 3 | $0.74 |
| Round 1 | 3 | $1.43 |
| Round 2 | 3 | $1.38 |
| Fixes round | 3 | $1.23 |
| Filing-fix check | 1 | $0.43 |
| Open shape | 3 | $1.17 |
| Gut-check | 3 | $0.94 |
| Routes | 4 | $1.59 |
| Range | 3 | $1.30 |
| **Total** | 35 | **$13.13** |

## 9. Open questions (no decisions taken)

- **Is two ideas enough range?** Making range pay off moved the agent from one reviewed idea to two in every scan. Whether to push further (three, or deliberately different routes) is open. In the blind read the range winners won 2 of 3, and the Spark Score matched every pick, but that's three pairs.
- **Which engine for what.** Since the comparison, the agent's process has changed substantially. Its quality against the fixed workflow (about 150 seconds a scan, deeper research) hasn't been re-judged blind. Cost isn't the deciding factor.
- **Consistency.** Every figure here comes from three briefs per round. Patterns held across rounds, but each round is a small sample.

## Commits on `day6-agent-mode` (local, not pushed)

c9eddb4 governor · 929a4e2 workspace and free tools · 1d4f4e5 loop, instructions, trace · 025ecd3 real API connections · 737464e agent-scan route and usage gate · 837c131 page changes · f5bcfa4, bb63844, cd5bec3 fixes from real runs · f7d3796 nudges · 67ad3bd revision rule change · 60b71f3 first write-up · 5476ecc round 1 · 8abea50 round 2 · efa4c7d finishing reserve, review estimate, settle-to-finish · 23c02ee flat signal filing · dbb594d write-up update · fd43821 open shape · e8fa04f gut-check · 0bee02d routes · 118ee3d range · ad75145 route labels and revision route
