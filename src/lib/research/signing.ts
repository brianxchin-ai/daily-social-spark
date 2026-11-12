import { createHmac, timingSafeEqual } from "node:crypto";
import type { Platform } from "@/lib/types";
import type { EvidenceLedger } from "./ledger.ts";

/**
 * Signed handoff between the research request and the creative request.
 *
 * The ledger travels through the browser, so the server signs it with a
 * secret only the server knows (HMAC-SHA256). The signature covers the
 * ledger, the brand, the platform and an expiration time. Anything altered,
 * mismatched or expired is rejected, never treated as trustworthy research.
 */

export const LEDGER_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const MIN_SECRET_LENGTH = 32;

interface SignedPayload {
  v: 1;
  brand: string;
  platform: Platform;
  exp: number;
  /** The scan attempt this research belongs to (public beta), so it can't be reused by another. */
  attempt?: string;
  ledger: EvidenceLedger;
}

export type VerifyResult =
  | { ok: true; ledger: EvidenceLedger; expiresAt: string }
  | { ok: false; reason: "malformed" | "altered" | "expired" | "mismatch"; message: string };

/** Brands are compared case- and spacing-insensitively ("Glossier" = " glossier "). */
export const normalizeBrand = (brand: string) => brand.trim().replace(/\s+/g, " ").toLowerCase();

function mac(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

function assertSecret(secret: string) {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("Ledger signing secret is missing or too short.");
}

export function signLedger(
  ledger: EvidenceLedger,
  binding: { brand: string; platform: Platform; attempt?: string },
  secret: string,
  now: Date,
  ttlMs = LEDGER_TTL_MS,
): { token: string; expiresAt: string } {
  assertSecret(secret);
  const exp = now.getTime() + ttlMs;
  const payload: SignedPayload = { v: 1, brand: normalizeBrand(binding.brand), platform: binding.platform, exp, ledger };
  if (binding.attempt) payload.attempt = binding.attempt;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${mac(body, secret).toString("base64url")}`, expiresAt: new Date(exp).toISOString() };
}

export function verifyLedger(
  token: unknown,
  binding: { brand: string; platform: Platform; attempt?: string },
  secret: string,
  now: Date,
): VerifyResult {
  assertSecret(secret);
  if (typeof token !== "string" || token.length > 2_000_000) {
    return { ok: false, reason: "malformed", message: "The research handoff is missing or malformed." };
  }
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) {
    return { ok: false, reason: "malformed", message: "The research handoff is missing or malformed." };
  }

  const expected = mac(body, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "altered", message: "The research handoff was altered or wasn't issued by this server." };
  }

  let payload: SignedPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed", message: "The research handoff couldn't be read." };
  }
  if (payload.v !== 1 || typeof payload.exp !== "number" || !payload.ledger) {
    return { ok: false, reason: "malformed", message: "The research handoff couldn't be read." };
  }
  if (now.getTime() > payload.exp) {
    return { ok: false, reason: "expired", message: "The research has expired. Run a new scan for fresh evidence." };
  }
  if (payload.brand !== normalizeBrand(binding.brand) || payload.platform !== binding.platform) {
    return { ok: false, reason: "mismatch", message: "The research was gathered for a different brand or platform." };
  }
  if ((payload.attempt ?? null) !== (binding.attempt ?? null)) {
    return { ok: false, reason: "mismatch", message: "The research belongs to a different scan." };
  }
  return { ok: true, ledger: payload.ledger, expiresAt: new Date(payload.exp).toISOString() };
}
