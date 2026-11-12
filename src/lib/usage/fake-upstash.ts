import { createServer, type Server } from "node:http";

/**
 * Test double for Upstash Redis's REST API: just the commands RedisRestStore
 * uses (SET with NX/PX, GET, DEL, and its two EVAL scripts), with random
 * delays so concurrent transactions interleave. Not used by the app.
 *
 * It mimics Redis's behavior; it isn't Redis. The real service still needs
 * one smoke test after it's provisioned.
 */
export async function startFakeUpstash(options: { token?: string; maxDelayMs?: number } = {}): Promise<{
  url: string;
  token: string;
  data: Map<string, { value: string; expiresAt: number | null }>;
  fail: { next: number };
  close: () => Promise<void>;
}> {
  const token = options.token ?? "test-token";
  const data = new Map<string, { value: string; expiresAt: number | null }>();
  const fail = { next: 0 };
  const read = (key: string) => {
    const entry = data.get(key);
    if (entry && entry.expiresAt !== null && Date.now() > entry.expiresAt) data.delete(key);
    return data.get(key)?.value ?? null;
  };

  const run = (args: (string | number)[]): unknown => {
    const [cmd, ...rest] = args.map(String);
    switch (cmd.toUpperCase()) {
      case "GET":
        return read(rest[0]);
      case "DEL":
        return data.delete(rest[0]) ? 1 : 0;
      case "SET": {
        const [key, value, ...flags] = rest;
        const upper = flags.map((f) => f.toUpperCase());
        if (upper.includes("NX") && read(key) !== null) return null;
        const px = upper.indexOf("PX");
        data.set(key, { value, expiresAt: px >= 0 ? Date.now() + Number(flags[px + 1]) : null });
        return "OK";
      }
      case "EVAL": {
        const [script, , ...keysAndArgs] = rest;
        if (script.includes('redis.call("SET"')) {
          const [lockKey, stateKey, lockId, state] = keysAndArgs;
          if (read(lockKey) !== lockId) return 0;
          data.set(stateKey, { value: state, expiresAt: null });
          data.delete(lockKey);
          return 1;
        }
        const [lockKey, lockId] = keysAndArgs;
        if (read(lockKey) !== lockId) return 0;
        data.delete(lockKey);
        return 1;
      }
      default:
        throw new Error(`unsupported command ${cmd}`);
    }
  };

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const delay = Math.random() * (options.maxDelayMs ?? 4);
      setTimeout(() => {
        res.setHeader("content-type", "application/json");
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.statusCode = 401;
          return res.end(JSON.stringify({ error: "Unauthorized" }));
        }
        if (fail.next > 0) {
          fail.next--;
          res.statusCode = 500;
          return res.end(JSON.stringify({ error: "ERR simulated outage" }));
        }
        try {
          res.end(JSON.stringify({ result: run(JSON.parse(body)) }));
        } catch (error) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: String(error) }));
        }
      }, delay);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    data,
    fail,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
