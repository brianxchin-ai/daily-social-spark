import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import {
  buildRegister,
  checkLedger,
  countBrandFree,
  LedgerDraftSchema,
  type EvidenceLedger,
  type LedgerDraft,
  type RawCitation,
  type RawSearch,
} from "@/lib/research/ledger";
import { PLATFORM_PROFILES } from "@/lib/research/platforms";
import { MAX_SEARCHES, SCOUT_FILING_PROMPT, scoutSearchPrompt } from "@/lib/research/prompts";
import type { ScanRequest } from "@/lib/types";
import { callStructured, callWithSearch, EngineError, type ScanUsage } from "./claude";

/**
 * The Scout: one specialist, two steps.
 *  1. Search the public web and write field notes. The API attaches a citation
 *     (URL, title, verbatim quote) to each supported sentence.
 *  2. File those notes into the strict ledger format, using only the citation
 *     IDs our code assigned. No tools in this step, so nothing new can enter.
 * Our code then checks everything (see research/ledger.ts).
 */

export { MAX_SEARCHES } from "@/lib/research/prompts";

/** Pull searches, citations and annotated notes out of the API's content blocks. */
export function extractScoutContent(content: Anthropic.Beta.Messages.BetaContentBlock[]): {
  searches: RawSearch[];
  rawCitations: RawCitation[];
  notes: { text: string; citations: RawCitation[] }[];
} {
  const queryById = new Map<string, string | null>();
  const searches: RawSearch[] = [];
  const rawCitations: RawCitation[] = [];
  const notes: { text: string; citations: RawCitation[] }[] = [];

  for (const block of content) {
    if (block.type === "server_tool_use" && block.name === "web_search") {
      const q = (block.input as { query?: unknown }).query;
      queryById.set(block.id, typeof q === "string" ? q : null);
    } else if (block.type === "web_search_tool_result") {
      const query = queryById.get(block.tool_use_id) ?? null;
      if (Array.isArray(block.content)) {
        searches.push({
          query,
          results: block.content.map((r) => ({ url: r.url, title: r.title, pageAge: r.page_age ?? null })),
          errorCode: null,
        });
      } else {
        searches.push({ query, results: null, errorCode: block.content.error_code });
      }
    } else if (block.type === "text") {
      const cites: RawCitation[] = [];
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location") cites.push({ url: c.url, citedText: c.cited_text });
      }
      rawCitations.push(...cites);
      notes.push({ text: block.text, citations: cites });
    }
  }
  return { searches, rawCitations, notes };
}

export async function runScout(
  request: ScanRequest,
  now: Date,
  signal?: AbortSignal,
): Promise<{ ledger: EvidenceLedger; usages: ScanUsage[] }> {
  const today = now.toISOString().slice(0, 10);
  const usages: ScanUsage[] = [];

  // Step 1: search and write cited notes.
  const searched = await callWithSearch({
    step: "scout-search",
    system: scoutSearchPrompt(request.platform, today),
    user: `Brand or category: ${request.brand}\nPlatform: ${PLATFORM_PROFILES[request.platform].label}\n\nResearch what is happening now that could inform this brand's short-form content.`,
    maxTokens: 8_000, // worst case ≈ $0.08 of output
    maxSearches: MAX_SEARCHES,
    timeoutMs: 150_000,
    signal,
  });
  usages.push(searched.usage);

  const { searches, rawCitations, notes } = extractScoutContent(searched.content);
  const register = buildRegister(searches, rawCitations);
  console.info(
    `[scout] searches=${searches.length} brandFree=${countBrandFree(register.queries, request.brand)} errors=${register.searchErrors.length} sources=${register.sources.length} citations=${register.citations.length}`,
  );

  // Nothing verifiable to file: skip step 2 and say why.
  if (register.citations.length === 0) {
    const reason =
      register.sources.length === 0
        ? "Search returned no usable sources."
        : "No statement in the notes could be tied to a quote from a retrieved source.";
    const draft: LedgerDraft = { signals: [], gaps: [reason], categoryTerms: [], searchPurposes: [] };
    return { ledger: checkLedger({ brand: request.brand, platform: request.platform, now, draft, register }), usages };
  }

  // Step 2: file the notes into the ledger, using our citation IDs.
  const idFor = (c: RawCitation) =>
    register.citations.find(
      (r) => r.quote === c.citedText.trim() && register.sources.find((s) => s.id === r.sourceId)?.url === c.url,
    )?.id;
  const annotated = notes
    .map((n) => {
      const ids = [...new Set(n.citations.map(idFor).filter(Boolean))];
      return ids.length ? `${n.text} [${ids.join("][")}]` : n.text;
    })
    .join("");
  const citationList = register.citations
    .map((c) => {
      const s = register.sources.find((x) => x.id === c.sourceId)!;
      return `${c.id} · ${s.domain} · "${s.title}"\n   Quote: "${c.quote}"`;
    })
    .join("\n");

  let filed;
  try {
    filed = await callStructured<LedgerDraft>({
      step: "scout-filing",
      system: SCOUT_FILING_PROMPT,
      user: `Brand or category: ${request.brand}
Platform: ${PLATFORM_PROFILES[request.platform].label}

Searches you ran (copy one exactly into lineageQuery if it checked a signal's lineage or history):
${register.queries.map((q) => `- ${q}`).join("\n") || "- (none)"}

Citations (the only IDs you may use):
${citationList}

Your field notes (citation IDs in brackets):
${annotated}`,
      schema: LedgerDraftSchema,
      maxTokens: 6_000, // worst case ≈ $0.06 of output
      timeoutMs: 60_000,
      signal,
      validate: (value) => {
        const parsed = LedgerDraftSchema.safeParse(value);
        return parsed.success
          ? { ok: true, value: parsed.data }
          : { ok: false, problems: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) };
      },
    });
  } catch (error) {
    // Keep step 1's billed cost on the error so the footer stays accurate.
    if (error instanceof EngineError) {
      throw new EngineError(error.message, error.status, combine([searched.usage, ...(error.usage ? [error.usage] : [])]));
    }
    throw error;
  }
  usages.push(filed.usage);

  const ledger = checkLedger({ brand: request.brand, platform: request.platform, now, draft: filed.value, register });
  console.info(
    `[scout] signals=${ledger.signals.length} observations=${ledger.observations.length} inferences=${ledger.inferences.length} adjustments=${ledger.adjustments.length}`,
  );
  return { ledger, usages };
}

/** Sum several calls into one usage record (used only when a later step fails). */
function combine(calls: ScanUsage[]): ScanUsage {
  return {
    step: calls.map((c) => c.step).join("+"),
    model: calls[0].model,
    inputTokens: calls.reduce((t, c) => t + c.inputTokens, 0),
    outputTokens: calls.reduce((t, c) => t + c.outputTokens, 0),
    estimatedCostUsd: calls.reduce((t, c) => t + c.estimatedCostUsd, 0),
    requestId: calls[0].requestId,
    webSearches: calls.reduce((t, c) => t + (c.webSearches ?? 0), 0),
  };
}
