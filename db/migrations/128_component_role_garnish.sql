-- 128: a garnish is a component.
--
-- NUMBERING. 128 follows this repository's 127. The number line is shared with
-- the CRM repo (db/baseline/DRIFT.md §2); checked against origin refs.
--
-- WHY
--
-- `formula_components_component_role_check` allows ingredient, water, sweetener,
-- acid, preservative, processing_aid, packaging_loss and intermediate. It has no
-- garnish, while `shared/ingredients.ts` has typed every parsed row as
-- `"ingredient" | "garnish"` since the cocktail resolver was written, and the
-- CRM types garnish rows explicitly — 38 recipes carry `Dehydrated Citrus`.
--
-- That is two vocabularies for one thing, which is the same shape as the bug
-- that made 56 syrups unreadable: the writer said one word, the reader expected
-- another, and nothing failed loudly.
--
-- WHY IT MATTERS RATHER THAN BEING TIDINESS
--
-- Ashley on the Jungle Bird: "margarita has a Tajín rim ... Jungle Bird Tajín
-- line is wrong." A garnish is part of the spec she checks. Scaling a cocktail
-- to forty drinks and not saying forty grape skewers is half an answer, and
-- storing a skewer as `ingredient` to dodge the constraint would make the
-- measured lines and the presentation lines indistinguishable — which is
-- exactly what a rim being in the wrong place looked like.
--
-- Nothing in TypeScript constrains this column: it is `z.string()` in the
-- router and `component_role?: string` in the client, so widening the check
-- breaks no caller. 28 existing rows use four of the eight values and none
-- becomes invalid.

alter table beverage.formula_components
  drop constraint formula_components_component_role_check;

alter table beverage.formula_components
  add constraint formula_components_component_role_check
  check (component_role = any (array[
    'ingredient', 'garnish', 'water', 'sweetener', 'acid',
    'preservative', 'processing_aid', 'packaging_loss', 'intermediate'
  ]));
