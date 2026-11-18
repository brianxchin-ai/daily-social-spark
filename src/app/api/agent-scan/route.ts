import { Governor } from "@/lib/agent/governor";
import { runAgent, type AgentEvent } from "@/lib/agent/loop";
import { toSpark } from "@/lib/agent/spark";
import { agentModel, agentPaidTools } from "@/lib/engine/agent-tools";
import { parseAudience } from "@/lib/prompts/audience";
import { parseRecentIdeas } from "@/lib/prompts/recent-ideas";
import { PLATFORMS, type Platform } from "@/lib/types";
import { beginAgentAttempt, identify, json, settle, usageGate } from "@/lib/usage/guard";
import type { Meter } from "@/lib/usage/meter";

/**
 * /api/agent-scan (Day 6): one scan by the agent engine, in one request.
 *
 * Local-only for now: it runs only with SPARK_ENGINE=claude and
 * SPARK_AGENT=on, and never on Vercel. The usage gate runs first, exactly as
 * for the fixed pipeline, with one $0.75 hold. The response is a stream of
 * lines (NDJSON): live steps as the agent works, then the finished result.
 */
export const maxDuration = 300;

type Availability = { available: true } | { available: false; reason: string };

function availability(env = process.env): Availability {
  if (env.VERCEL) return { available: false, reason: "Agent mode is local-only for now." };
  if (env.SPARK_ENGINE !== "claude") return { available: false, reason: "The Claude engine isn't selected (SPARK_ENGINE)." };
  if (env.SPARK_AGENT !== "on") return { available: false, reason: "Agent mode is off (SPARK_AGENT)." };
  return { available: true };
}

/** GET: whether agent mode can run here, so the page shows the switch only when it can. */
export async function GET() {
  return Response.json(availability(), { headers: { "cache-control": "no-store" } });
}

/** POST: run one agent scan, streaming its steps. */
export async function POST(request: Request) {
  const status = availability();
  if (!status.available) return Response.json({ error: status.reason }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const { brand, platform, audience, recentIdeas } = (body ?? {}) as Record<string, unknown>;
  if (typeof brand !== "string" || !brand.trim() || brand.length > 120) {
    return Response.json({ error: "Enter a brand or category (up to 120 characters)." }, { status: 400 });
  }
  if (!PLATFORMS.some((p) => p.id === platform)) return Response.json({ error: "Unknown platform." }, { status: 400 });
  const parsedAudience = parseAudience(audience);
  if (!parsedAudience.ok) return Response.json({ error: parsedAudience.error }, { status: 400 });
  const brief = {
    brand: brand.trim(),
    platform: platform as Platform,
    audience: parsedAudience.audience,
    recentIdeas: parseRecentIdeas(recentIdeas),
  };

  // Usage limits come before any paid call, as for every scan.
  const gate = usageGate();
  const who = identify(request);
  const begin = await beginAgentAttempt(gate, who);
  if (!begin.ok) return json(begin.body, { status: begin.status, who });

  const governor = new Governor();
  const encoder = new TextEncoder();
  const stamp = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (line: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          open = false; // the page went away (its cancel signal also stops the run); charging still happens below
        }
      };
      try {
        const run = await runAgent({
          brief,
          model: agentModel(),
          tools: agentPaidTools(),
          governor,
          idPrefix: `cand-${stamp}`,
          signal: request.signal,
          onEvent: (event: AgentEvent) => send(event),
        });
        const spark = toSpark(run, { stamp, now: new Date() });
        console.info(`[agent] ${run.ending.how} after ${run.turns} turns, $${run.snapshot.spentUsd.toFixed(4)} estimated, ${run.steps.length} steps`);
        send({ type: "result", spark });
      } catch (error) {
        console.warn(`[agent] unexpected error: ${error instanceof Error ? error.name : "unknown"}`);
        send({ type: "error", error: "The agent scan stopped on an unexpected error. Nothing was retried." });
      } finally {
        // Charge what the governor recorded: measured costs, with any call that
        // ended without a readable bill already counted at its full worst case.
        // Anything still in flight is counted too, so a crash can only overcount.
        const meter: Meter = { knownUsd: governor.committedUsd(), uncertain: false, unknownModels: [] };
        await settle(gate, begin, meter, false);
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
  });

  const headers = new Headers({ "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
  if (who.setCookie) headers.append("set-cookie", who.setCookie);
  return new Response(stream, { headers });
}
