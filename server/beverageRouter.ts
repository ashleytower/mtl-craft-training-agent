import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { humanProcedure, operatorProcedure, router } from "./_core/trpc";
import * as beverage from "./beverageClient";
import { scaleFormula, type NormalizedFormula } from "./beverageScaling";

/** A decimal string as Postgres `numeric` renders it. */
const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, "must be a decimal number");

const componentInput = z.object({
  line_number: z.number().int().min(1, "line_number starts at 1"),
  ingredient_name: z.string().trim().min(1, "ingredient_name is required"),
  ingredient_key: z.string().trim().optional(),
  quantity: decimalString,
  unit: z.string().trim().min(1, "unit is required"),
  component_role: z.string().trim().optional(),
  optional: z.boolean().optional(),
  source_locator: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

/**
 * One preparation step. A blank step is rejected here rather than silently
 * dropped, so an operator who leaves a row empty is told, instead of finding
 * the step missing from an approved formula later.
 */
const processStepInput = z.object({
  section: z.string().trim().min(1).nullish(),
  text: z.string().trim().min(1, "a preparation step cannot be empty"),
});

const scaleRequest = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("multiplier"), multiplier: decimalString }),
  z.object({ mode: z.literal("targetYield"), targetYieldValue: decimalString }),
  z.object({
    mode: z.literal("limitingIngredient"),
    ingredientName: z.string().trim().min(1, "ingredientName is required"),
    availableQuantity: decimalString,
    unit: z.string().trim().min(1, "unit is required"),
  }),
]);

type ApprovedFormula = {
  id: string;
  formula_key: string;
  version_number: number;
  name: string;
  product_category: string | null;
  intended_yield_value: string | null;
  intended_yield_unit: string | null;
  approved_at: string | null;
  components: Array<{
    line_number: number;
    ingredient_name: string;
    quantity: string;
    unit: string;
  }>;
};

/**
 * Surface the database's own refusal text. These functions raise on purpose
 * ("Approval rationale is required", "Owner or approver role required"), and an
 * operator needs the actual reason, not a generic failure.
 */
function asRefusal(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

export const beverageRouter = router({
  /** Who the database thinks this operator is, and with what role. */
  context: operatorProcedure.query(async ({ ctx }) => {
    try {
      return await beverage.ensureContext(ctx.identity);
    } catch (error) {
      return asRefusal(error);
    }
  }),

  dashboard: operatorProcedure.query(async ({ ctx }) => {
    try {
      return await beverage.dashboard(ctx.identity);
    } catch (error) {
      return asRefusal(error);
    }
  }),

  listDrafts: operatorProcedure.query(async ({ ctx }) => {
    try {
      return await beverage.listFormulaDrafts(ctx.identity);
    } catch (error) {
      return asRefusal(error);
    }
  }),

  listApproved: operatorProcedure.query(async ({ ctx }) => {
    try {
      return (await beverage.listApprovedFormulas(ctx.identity)) as ApprovedFormula[];
    } catch (error) {
      return asRefusal(error);
    }
  }),

  listPending: operatorProcedure.query(async ({ ctx }) => {
    try {
      return await beverage.listPendingFormulaVersions(ctx.identity);
    } catch (error) {
      return asRefusal(error);
    }
  }),

  createVersion: humanProcedure
    .input(
      z.object({
        formulaDraftId: z.string().uuid("formulaDraftId must be a uuid"),
        formulaKey: z.string().trim().min(1, "formulaKey is required"),
        name: z.string().trim().min(1, "name is required"),
        // Planned yield is optional: for a new build nobody knows the yield
        // until a batch has been made. Half of one is a mistake, not a plan.
        yieldValue: decimalString.optional(),
        yieldUnit: z.string().trim().min(1).optional(),
        components: z
          .array(componentInput)
          .min(1, "at least one normalized component is required"),
        // Optional, and optional for a real reason: a syrup has no method in
        // the intake at all, so requiring one here would block the category
        // this workbench exists to serve.
        processSteps: z.array(processStepInput).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if ((input.yieldValue === undefined) !== (input.yieldUnit === undefined)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A planned yield needs both a value and a unit, or neither.",
        });
      }
      try {
        return await beverage.createFormulaVersion(ctx.identity, input);
      } catch (error) {
        return asRefusal(error);
      }
    }),

  approveVersion: humanProcedure
    .input(
      z.object({
        formulaVersionId: z.string().uuid("formulaVersionId must be a uuid"),
        rationale: z.string().trim().min(1, "an approval rationale is required"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await beverage.approveFormulaVersion(ctx.identity, input);
      } catch (error) {
        return asRefusal(error);
      }
    }),

  /**
   * Scale an APPROVED formula. Unapproved work is unreachable here by
   * construction: the only source of components is the approved-formula
   * listing, so a draft can never be scaled into a batch sheet.
   *
   * `record: true` persists the calculation as evidence. Scaling itself never
   * releases a batch — the result always reports `not_released`.
   */
  scale: operatorProcedure
    .input(
      z.object({
        formulaVersionId: z.string().uuid("formulaVersionId must be a uuid"),
        request: scaleRequest,
        record: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let approved: ApprovedFormula[];
      try {
        approved = (await beverage.listApprovedFormulas(ctx.identity)) as ApprovedFormula[];
      } catch (error) {
        return asRefusal(error);
      }

      const match = approved.find(f => f.id === input.formulaVersionId);
      if (!match) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "That formula version is not an approved formula. Only approved versions can be scaled.",
        });
      }

      const formula: NormalizedFormula = {
        formulaVersionId: match.id,
        name: match.name,
        intendedYieldValue: match.intended_yield_value,
        intendedYieldUnit: match.intended_yield_unit,
        components: (match.components ?? []).map(c => ({
          lineNumber: c.line_number,
          ingredientName: c.ingredient_name,
          quantity: c.quantity,
          unit: c.unit,
        })),
      };

      let result;
      try {
        result = scaleFormula(formula, input.request);
      } catch (error) {
        return asRefusal(error);
      }

      if (input.record) {
        try {
          await beverage.recordCalculationPlan(ctx.identity, {
            formulaVersionId: match.id,
            planType: input.request.mode,
            inputPayload: input.request,
            outputPayload: result,
          });
        } catch (error) {
          return asRefusal(error);
        }
      }

      return result;
    }),
});
