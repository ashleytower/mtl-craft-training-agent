import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { hermesIdentityFromRequest } from "./hermesService";
import { authenticateRequest, type OperatorIdentity } from "./supabaseAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  /** Verified Supabase operator. The identity of record for governed work. */
  identity: OperatorIdentity | null;
  /**
   * Legacy MySQL user row, kept only for the pre-existing chat/voice routers
   * that key conversations off an integer id. It is null whenever DATABASE_URL
   * is unset, which is exactly how those routers already behaved.
   */
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let identity: OperatorIdentity | null = null;

  try {
    identity = await authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    identity = null;
  }

  // A signed-in human always wins; the agent boundary is only consulted when
  // no browser session was presented.
  if (!identity) {
    identity = hermesIdentityFromRequest(opts.req);
  }

  let user: User | null = null;
  if (identity) {
    try {
      user = (await db.getUserByOpenId(identity.subject)) ?? null;
    } catch (error) {
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    identity,
    user,
  };
}
