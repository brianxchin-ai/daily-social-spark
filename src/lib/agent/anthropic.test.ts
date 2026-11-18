import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicAgentModel, anthropicResearchTools } from "./anthropic.ts";
import { FakeTools } from "./fakes.ts";
import { NOW } from "./fixtures.ts";
import { CallFailure, runAgent, toolSpecs } from "./loop.ts";

/**
 * The real API connection, tested against a fake Anthropic API on this
 * machine. No network, no key, no cost: the fake answers in the API's own
 * response format, so the SDK, the request shapes and the response parsing
 * are all exercised for real.
 */

type Handler = (body: Record<string, unknown>, res: ServerResponse) => void;
let handler: Handler = () => {};
const requests: Record<string, unknown>[] = [];
let server: ReturnType<typeof createServer>;
let client: Anthropic;

const message = (content: unknown[], stop: string, usage: Record<string, unknown> = {}) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 500, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, ...usage },
});
const reply = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "request-id": "req_test" });
  res.end(JSON.stringify(body));
};

before(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      requests.push(body);
      handler(body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  client = new Anthropic({ apiKey: "test-key-not-real", baseURL: `http://127.0.0.1:${port}`, maxRetries: 0 });
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const PAGE = "https://news.example.org/desk-reset-videos";

describe("agent turns", () => {
  it("sends the tools with prompt caching on and no model fallback, and reads cache usage", async () => {
    requests.length = 0;
    handler = (_b, res) =>
      reply(res, 200, message([{ type: "thinking", thinking: "plan", signature: "s" }, { type: "tool_use", id: "toolu_1", name: "review_evidence", input: { why: "Check." } }], "tool_use", { cache_read_input_tokens: 9_000, cache_creation_input_tokens: 1_000 }));
    const model = anthropicAgentModel(client);
    const out = await model.turn({ system: "sys", messages: [{ role: "user", content: [{ type: "text", text: "Begin." }] }], tools: toolSpecs(), maxOutputTokens: 4_000, timeoutMs: 5_000 });
    const sent = requests[0];
    assert.deepEqual(sent.cache_control, { type: "ephemeral" });
    assert.equal((sent.output_config as { effort?: string }).effort, "high", "the director thinks at high effort");
    assert.equal("fallbacks" in sent, false);
    assert.equal(sent.max_tokens, 4_000);
    assert.equal((sent.tools as unknown[]).length, 12);
    assert.equal(out.stopReason, "tool_use");
    assert.equal(out.usage.cacheReadTokens, 9_000);
    assert.equal(out.usage.cacheWriteTokens, 1_000);
    assert.equal(out.content[0].type, "thinking", "thinking is kept, to pass back unchanged");
  });

  it("reports an API error as not billed, and never retries", async () => {
    requests.length = 0;
    handler = (_b, res) => reply(res, 500, { type: "error", error: { type: "api_error", message: "boom" } });
    await assert.rejects(
      anthropicAgentModel(client).turn({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], tools: [], maxOutputTokens: 100, timeoutMs: 5_000 }),
      (e: unknown) => e instanceof CallFailure && e.maybeBilled === false,
    );
    assert.equal(requests.length, 1);
  });

  it("reports a timeout as possibly billed", async () => {
    handler = () => {}; // never answers
    await assert.rejects(
      anthropicAgentModel(client).turn({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], tools: [], maxOutputTokens: 100, timeoutMs: 300 }),
      (e: unknown) => e instanceof CallFailure && e.maybeBilled === true && /took too long/.test(e.message),
    );
  });
});

describe("research tools", () => {
  it("runs one direct search and reads results and quotes only from the API's blocks", async () => {
    requests.length = 0;
    handler = (_b, res) =>
      reply(
        res,
        200,
        message(
          [
            { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "desk reset videos" } },
            {
              type: "web_search_tool_result",
              tool_use_id: "srvtoolu_1",
              content: [{ type: "web_search_result", url: PAGE, title: "Desk resets", page_age: "November 11, 2026", encrypted_content: "x" }],
            },
            {
              type: "text",
              text: "Students post desk resets.",
              citations: [{ type: "web_search_result_location", url: PAGE, title: "Desk resets", cited_text: "On November 10, 2026, creators began posting.", encrypted_index: "x" }],
            },
          ],
          "end_turn",
          { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
        ),
      );
    const out = await anthropicResearchTools(client).search({ query: "desk reset videos", maxOutputTokens: 2_000, timeoutMs: 5_000 });
    const tool = (requests[0].tools as Record<string, unknown>[])[0];
    assert.equal(tool.type, "web_search_20260209");
    assert.equal(tool.max_uses, 1);
    assert.deepEqual(tool.allowed_callers, ["direct"]);
    assert.equal(out.results[0].url, PAGE);
    assert.equal(out.results[0].pageAge, "November 11, 2026");
    assert.equal(out.citations[0].citedText, "On November 10, 2026, creators began posting.");
    assert.equal(out.executedQuery, "desk reset videos");
    assert.equal(out.billed.usage.webSearches, 1);
  });

  it("reads one page on its own site only, and ties quotes to the page actually fetched", async () => {
    requests.length = 0;
    handler = (_b, res) =>
      reply(
        res,
        200,
        message(
          [
            { type: "server_tool_use", id: "srvtoolu_2", name: "web_fetch", input: { url: PAGE } },
            {
              type: "web_fetch_tool_result",
              tool_use_id: "srvtoolu_2",
              content: { type: "web_fetch_result", url: PAGE, retrieved_at: null, content: { type: "document", source: { type: "text", media_type: "text/plain", data: "..." }, title: "Desk resets", citations: { enabled: true } } },
            },
            { type: "text", text: "It began in November.", citations: [{ type: "char_location", cited_text: "Posting began November 10, 2026.", document_index: 0, document_title: "Desk resets", start_char_index: 0, end_char_index: 10, file_id: null }] },
          ],
          "end_turn",
        ),
      );
    const out = await anthropicResearchTools(client).read({ url: PAGE, title: "Desk resets", question: "When did it start?", maxOutputTokens: 2_000, timeoutMs: 5_000 });
    const tool = (requests[0].tools as Record<string, unknown>[])[0];
    assert.equal(tool.type, "web_fetch_20260209");
    assert.equal(tool.max_uses, 1);
    assert.deepEqual(tool.allowed_domains, ["news.example.org"]);
    assert.equal(tool.max_content_tokens, 8_000);
    assert.deepEqual(out.citations, [{ url: PAGE, citedText: "Posting began November 10, 2026." }]);
  });

  it("returns no quotes when the fetch failed", async () => {
    handler = (_b, res) =>
      reply(res, 200, message([{ type: "web_fetch_tool_result", tool_use_id: "s", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } }, { type: "text", text: "Couldn't read it." }], "end_turn"));
    const out = await anthropicResearchTools(client).read({ url: PAGE, title: "t", question: "q", maxOutputTokens: 2_000, timeoutMs: 5_000 });
    assert.deepEqual(out.citations, []);
  });
});

describe("a whole run over the real connection (fake API)", () => {
  it("searches, files the result, and abstains, with every result passed back", async () => {
    requests.length = 0;
    let agentTurns = 0;
    handler = (body, res) => {
      const tools = body.tools as { name: string }[];
      if (tools.some((t) => t.name === "web_search" && "max_uses" in t)) {
        return reply(
          res,
          200,
          message(
            [
              { type: "server_tool_use", id: "srv", name: "web_search", input: { query: "desk reset" } },
              { type: "web_search_tool_result", tool_use_id: "srv", content: [{ type: "web_search_result", url: PAGE, title: "Desk resets", page_age: null, encrypted_content: "x" }] },
              { type: "text", text: "Found it.", citations: [{ type: "web_search_result_location", url: PAGE, title: "t", cited_text: "On November 10, 2026, creators began posting.", encrypted_index: "x" }] },
            ],
            "end_turn",
            { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
          ),
        );
      }
      agentTurns += 1;
      if (agentTurns === 1) return reply(res, 200, message([{ type: "tool_use", id: "toolu_a", name: "web_search", input: { query: "desk reset", purpose: "category", why: "Look." } }], "tool_use"));
      const last = (body.messages as { content: { type: string; tool_use_id?: string }[] }[]).at(-1)!;
      assert.equal(last.content[0].tool_use_id, "toolu_a", "the search result went back to the agent");
      return reply(res, 200, message([{ type: "tool_use", id: "toolu_b", name: "abstain", input: { reason: "Test run." } }], "tool_use"));
    };
    const fake = new FakeTools({});
    const run = await runAgent({
      brief: { brand: "Acme Coffee", platform: "tiktok", recentIdeas: [] },
      model: anthropicAgentModel(client),
      tools: { ...fake, ...anthropicResearchTools(client), evaluate: fake.evaluate.bind(fake), rescore: fake.rescore.bind(fake) },
      now: () => NOW,
    });
    assert.equal(run.ending.how, "abstained");
    assert.equal(run.workspace.sources[0].url, PAGE);
    assert.equal(run.workspace.usableCitations().length, 1);
    assert.deepEqual(run.calls.map((c) => c.step), ["agent-turn", "search", "agent-turn"]);
    assert.ok(run.snapshot.spentUsd > 0);
  });
});
