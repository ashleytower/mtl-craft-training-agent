/**
 * Hermes agent service boundary.
 *
 * Mirrors the narrowly scoped service route already used by the inventory
 * backend: a shared token, off unless explicitly enabled, acting as one
 * configured operator and nothing else. It cannot select a different subject,
 * and the identity it returns is marked `origin: "hermes"` so that governed
 * writes — creating and approving formula versions — refuse it structurally
 * rather than by instruction.
 */
import { timingSafeEqual } from "crypto";
import type { Request } from "express";
import type { OperatorIdentity } from "./supabaseAuth";

const HEADER = "x-hermes-service-token";

/**
 * Constant-time compare that refuses empty input outright. A blank or
 * whitespace-only configured secret must never authenticate anything — that
 * exact bypass has bitten this estate before.
 */
function tokenMatches(provided: string, expected: string): boolean {
  if (provided.trim() === "" || expected.trim() === "") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function hermesIdentityFromRequest(req: Request): OperatorIdentity | null {
  if (process.env.HERMES_SERVICE_ENABLED !== "true") return null;

  const expected = process.env.HERMES_SERVICE_TOKEN ?? "";
  const subject = (process.env.HERMES_SERVICE_SUBJECT ?? "").trim();
  if (expected.trim() === "" || subject === "") return null;

  const provided = req.headers[HEADER];
  if (typeof provided !== "string") return null;
  if (!tokenMatches(provided, expected)) return null;

  return {
    subject,
    email: null,
    displayName: process.env.HERMES_SERVICE_DISPLAY_NAME ?? "Hermes beverage agent",
    origin: "hermes",
  };
}
