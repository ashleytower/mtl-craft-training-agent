import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

/**
 * Requires a verified Supabase operator. This is the gate for governed
 * beverage work — it depends on the identity provider only, never on the
 * legacy MySQL mirror.
 */
const requireOperator = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.identity) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      identity: ctx.identity,
    },
  });
});

export const operatorProcedure = t.procedure.use(requireOperator);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * Governed writes. Requires a signed-in human, not the Hermes agent boundary:
 * approving a formula is a person's decision and must stay one.
 */
const requireHuman = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.identity) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (ctx.identity.origin !== "browser") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This action requires a signed-in person. The Hermes agent can read and scale, but cannot create or approve a formula version.",
    });
  }

  return next({ ctx: { ...ctx, identity: ctx.identity } });
});

export const humanProcedure = t.procedure.use(requireHuman);
