# Open product decisions

Questions raised in testing that are recorded for future review. Nothing here changes current behavior until a decision is made.

## 1. Revisions that resolve brand-safety concerns (raised Day 2, Checkpoint 4)

**Status:** Open. The five-point minimum improvement threshold stays in place for now.

**What we observed.** In the Glossier on TikTok live test (2026-11-10), the leading candidate, "Community Product Rehab" (Concept Score 92.5), asked customers to dump out their makeup bags and sort products into keep, toss and try-instead piles. The editor named its biggest weakness as brand fit: the "toss" pile put Glossier in the position of judging a customer's own products, which clashes with its warm, anti-judgment voice and could embarrass guests on camera.

The revision kept the dump-and-sort mechanic but gave the customer every call, renaming the piles daily, special occasion and retire. It was qualitatively stronger because it resolved a potentially judgmental interaction with customers.

The rescore passed all three checks (mechanic preserved, weakness addressed, no unsupported claims) and the revision was not rejected. However:

- The targeted criterion, Brand/Category + Platform Fit, stayed at 4.
- The 2.5-point gain (92.5 → 95) came entirely from Cross-Platform Potential (4 → 5).
- Because the gain was below the five-point minimum, the system kept the original.

This is not a technical failure: the rules behaved exactly as designed. It does raise two questions.

**Open questions**

1. Should a revision that resolves a meaningful brand-safety or reputational concern be eligible to replace the original even when its Concept Score improves by fewer than five points?
2. Should we require the evaluator to explicitly explain why the criterion targeted by the critique did or didn't improve?

**To decide later.** Collect more refinement cases before changing the rule, so any change is based on a pattern rather than a single scan.

## 2. Ties in the Provisional Ranking Score (raised Day 3, Checkpoint 2)

**Status:** Open, documented. The rubric and ranking rules are unchanged for now.

**What we observed.** In the second live end-to-end Glossier on TikTok test (2026-11-11), two ideas tied at a Provisional Ranking Score of 65, both with a Concept Score of 80 and both evidence criteria unverified:

- "Tiny-text skin confession": an off-category attention mechanic turned into a Glossier brand truth (brand fit 5).
- "Hallelujah list, brand-owned": a known list template from an April 2026 meme, which the Scout itself flagged as likely past its peak.

The agreed tie-break order (remixability, then comprehension, …) decided it: comprehension 5 vs. 4, so the hallelujah list "won", even though it was less timely and less distinctive. With every evidence criterion on the same placeholder, the tie-break carried more weight than it deserves.

**For Checkpoint 3 (interface).** Show tied or near-tied provisional results as tied: say how the tie was broken and avoid implying an unambiguous winner.

**Open question.** Should ties (or near-ties) between provisional scores be broken differently, or presented as a shortlist? Decide after more runs.

## 3. Research allocation for depth searches (raised Day 3, Checkpoint 2)

**Status:** Open, documented for a future improvement. No new architecture now.

**What we observed.** Across live Scout runs, the depth searches (corroboration and lineage) went repeatedly to a signal already known to be stale ("Everything Hallelujah", April 2026), while promising off-category findings stayed single-source: the tiny-text reveal, and a hustle-culture parody "first seen 3 November 2026". The ideas that most depended on those signals therefore stayed unverified, and the Scout left searches unused.

**Possible direction.** Allocate depth searches to the signals the shortlist depends on (fresh, off-category, single-source), rather than to well-covered ones. Decide on the approach later.
