/**
 * Supabase-backed request authentication.
 *
 * This replaces the Manus platform OAuth flow (`sdk.authenticateRequest`) as the
 * only source of identity for the API. The browser holds the Supabase session
 * and sends its access token as a bearer header; the server verifies that token
 * against the project using the service-role client. There is no callback route
 * and no session cookie to forge.
 *
 * The verified `subject` is the Supabase `auth.users.id`, which is exactly what
 * the governed beverage RPCs expect as `p_external_subject`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request } from "express";

export type OperatorIdentity = {
  /** Supabase auth.users.id — the beverage `external_subject`. */
  subject: string;
  email: string | null;
  displayName: string | null;
  /**
   * How this identity was established. "browser" is a signed-in human;
   * "hermes" is the agent service boundary. Governed writes require "browser",
   * so an agent cannot approve a formula even if it is told to.
   */
  origin: "browser" | "hermes";
};

let _admin: SupabaseClient | null = null;

/**
 * Service-role client. Fails loudly rather than degrading: a silent fallback
 * here would mean an unauthenticated request quietly looking authenticated.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to authenticate requests"
      );
    }
    _admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

function readAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() || null;
  }
  return null;
}

/**
 * Returns the verified operator, or null when the request carries no usable
 * token. Never throws for an anonymous request — public procedures still work.
 */
export async function authenticateRequest(req: Request): Promise<OperatorIdentity | null> {
  const token = readAccessToken(req);
  if (!token) return null;

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;

  const metadata = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : null;

  return {
    subject: data.user.id,
    email: data.user.email ?? null,
    displayName: fullName ?? data.user.email ?? null,
    origin: "browser",
  };
}
