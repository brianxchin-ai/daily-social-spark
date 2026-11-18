# Day 6: Fixed workflow vs. an autonomous agent

**Summary.** On 2026-11-18 we built a second engine for Daily Social Spark on the local branch `day6-agent-mode`.

- **The experiment.** Instead of a production schedule written in code (Scout → Generator → Evaluator → Editor), one AI "creative director" chooses its own next move with a toolkit: search, read a source, file evidence, write ideas, develop, send for review, revise, finish. Code keeps the money, the clock, the scoring and the honesty rules.
- **Six briefs, three each.** In a blind side-by-side on three briefs, the agent produced the idea we preferred on two of the three. It ran about twice as fast at half the cost.
- **It didn't use its freedom.** It took the same short path every time, did less research than the fixed workflow, and never dug deeper, revised or changed course.
- **The finding.** The architecture delivered efficiency, not deliberation.

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

## 7. Spending (2026-11-18, local runs on the user's key)

| | Runs | Estimated cost |
|---|---|---|
| Agent development runs | 6 | $1.38 |
| Comparison: fixed workflow | 3 | $1.54 |
| Comparison: agent | 3 | $0.74 |
| **Total** | 12 | **$3.66** |

## 8. Open questions (no decisions taken)

- **Agent mode or fixed workflow?**
  - Does agent mode's speed and cost advantage justify offering it, for example as the beta engine?
  - Or is the fixed workflow's deeper research worth the extra minute and quarter?
- **Making the agent dig deeper.**
  - Should the agent be given stronger reasons to research more?
  - Or accept that it's essentially a faster, cheaper workflow?
- **The two signals.** Is it worth a larger blind review (more briefs, more judges) to see how the Spark Score and human picks relate?

## Commits on `day6-agent-mode` (local, not pushed)

c9eddb4 governor · 929a4e2 workspace and free tools · 1d4f4e5 loop, instructions, trace · 025ecd3 real API connections · 737464e agent-scan route and usage gate · 837c131 page changes · f5bcfa4, bb63844, cd5bec3 fixes from real runs · f7d3796 nudges · 67ad3bd revision rule change
