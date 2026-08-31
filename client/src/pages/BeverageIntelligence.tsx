import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { cleanFormulaName } from "@shared/formulaName";
import { parseMethodDraft, type MethodStep } from "@shared/method";

import {
  resolveDraftIngredients,
  type CatalogEntry,
  type CrmRecipe,
  type DraftResolution,
  type IngredientIssue,
} from "@shared/ingredients";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type DraftIngredient = {
  ingredient_name: string | null;
  quantity_normalized: string | null;
  unit_name: string | null;
};

type FormulaDraft = {
  id: string;
  name: string;
  product_category: string;
  draft_status: string;
  intended_yield_value: string | null;
  intended_yield_unit: string | null;
  source_url: string | null;
  /** Freeform method text from the intake. Cocktails carry it; syrups never do. */
  method_source_text: string | null;
  original_recipe_json: { ingredients?: DraftIngredient[] } | null;
};

type VersionComponent = {
  line_number: number;
  ingredient_name: string;
  // Postgres numeric arrives as a JSON number, not a string.
  quantity: string | number;
  unit: string;
};

type FormulaVersion = {
  id: string;
  formula_key: string;
  version_number: number;
  name: string;
  intended_yield_value: string | null;
  intended_yield_unit: string | null;
  components: VersionComponent[];
};

type ComponentDraft = { ingredient_name: string; quantity: string; unit: string };

/**
 * The scaler keeps 28 decimal places so nothing is silently lost. Nobody
 * measuring in a prep kitchen can read that, so shorten it for display only —
 * the exact fraction is shown alongside and the stored value is untouched.
 */
const DISPLAY_DECIMALS = 4;

function readable(value: string | number, isExact: boolean): string {
  const text = String(value);
  const dot = text.indexOf(".");
  if (dot === -1) return text;
  const trimmed = text.slice(0, dot + 1 + DISPLAY_DECIMALS).replace(/\.?0+$/, "");
  return isExact && trimmed === text ? text : `${trimmed}…`;
}

/**
 * tRPC serialises zod issues into the message as raw JSON. Showing that to an
 * operator is worse than useless, so pull the human sentence back out.
 */
function humanError(message: string): string {
  try {
    const parsed = JSON.parse(message);
    if (Array.isArray(parsed)) {
      const messages = parsed.map(i => i?.message).filter(Boolean);
      if (messages.length) return messages.join(". ");
    }
  } catch {
    // not JSON — it is already a human sentence from the database
  }
  return message;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * One sentence per issue, in the operator's terms. The resolver decides what is
 * wrong; this only decides how to say it.
 */
function issueText(issue: IngredientIssue): string {
  switch (issue.code) {
    case "no_quantity_in_source":
      return "no quantity in the source";
    case "no_unit_in_source":
      return "has a quantity but no unit";
    case "quantity_is_zero":
      return "recorded as zero";
    case "unit_not_recognised":
      return `"${issue.unit}" is not a unit this system can convert`;
    case "quantity_not_exact":
      return `"${issue.text}" has no exact decimal form`;
    case "type_unit_mismatch":
      return `typed "${issue.type}" but measured in "${issue.unit}" — the CRM record disagrees with itself`;
    case "ambiguous_catalog_match":
      return `matches ${issue.candidates.length} formulas — pick one by hand`;
  }
}

/**
 * What the resolver may link an ingredient to. Built from what the workbench has
 * already loaded rather than from a new endpoint: approved formulas can become a
 * sub-component, and names already used in a structured draft are known
 * ingredients. Nothing here is fuzzy — an exact name or no link at all.
 */
function buildCatalog(
  approved: FormulaVersion[],
  drafts: FormulaDraft[]
): CatalogEntry[] {
  const entries: CatalogEntry[] = approved.map(f => ({
    key: f.formula_key ?? null,
    name: f.name,
    kind: "approved_formula",
  }));
  const seen = new Set(entries.map(e => e.name.trim().toLowerCase()));
  for (const draft of drafts) {
    for (const row of draft.original_recipe_json?.ingredients ?? []) {
      const name = (row.ingredient_name ?? "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      entries.push({ key: null, name, kind: "known_ingredient" });
    }
  }
  return entries;
}

/** Components the dialog should start from. A blank quantity is left blank. */
function componentsFrom(resolution: DraftResolution): ComponentDraft[] {
  return resolution.items
    .filter(item => item.role === "ingredient")
    .map(item => ({
      ingredient_name: item.name,
      quantity: item.quantity ?? "",
      unit: item.unit ?? "",
    }));
}

export default function BeverageIntelligence() {
  const [, setLocation] = useLocation();
  // Gate on the session itself rather than on a failed request. A signed-out
  // visitor should never see the workbench shell, and should never fire four
  // requests that are guaranteed to 401.
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        setHasSession(false);
        setLocation("/login");
        return;
      }
      setHasSession(true);
    });
    return () => {
      active = false;
    };
  }, [setLocation]);

  const enabled = hasSession === true;
  const utils = trpc.useUtils();
  const context = trpc.beverage.context.useQuery(undefined, { enabled });
  const drafts = trpc.beverage.listDrafts.useQuery(undefined, { enabled });
  const pending = trpc.beverage.listPending.useQuery(undefined, { enabled });
  const approved = trpc.beverage.listApproved.useQuery(undefined, { enabled });
  // The CRM is the source of truth for a cocktail's measures.
  const crmRecipes = trpc.beverage.listCrmRecipes.useQuery(undefined, { enabled });

  const [normalizing, setNormalizing] = useState<FormulaDraft | null>(null);
  const [formulaName, setFormulaName] = useState("");
  const [yieldValue, setYieldValue] = useState("");
  const [yieldUnit, setYieldUnit] = useState("L");
  const [components, setComponents] = useState<ComponentDraft[]>([]);
  const [methodSteps, setMethodSteps] = useState<MethodStep[]>([]);
  const [resolution, setResolution] = useState<DraftResolution | null>(null);
  const [rationale, setRationale] = useState<Record<string, string>>({});

  const [scaleTarget, setScaleTarget] = useState<string>("");
  const [scaleMode, setScaleMode] =
    useState<"multiplier" | "targetYield" | "limitingIngredient">("multiplier");
  const [multiplier, setMultiplier] = useState("2");
  const [targetYield, setTargetYield] = useState("");
  const [limitIngredient, setLimitIngredient] = useState("");
  const [limitQuantity, setLimitQuantity] = useState("");
  const [limitUnit, setLimitUnit] = useState("");
  const [scaleResult, setScaleResult] = useState<
    ReturnType<typeof scaleResultShape> | null
  >(null);

  const createVersion = trpc.beverage.createVersion.useMutation({
    onSuccess: () => {
      toast.success("Draft version created. It still needs approval.");
      setNormalizing(null);
      void utils.beverage.listPending.invalidate();
      void utils.beverage.listDrafts.invalidate();
    },
    onError: error => toast.error(humanError(error.message)),
  });

  const approveVersion = trpc.beverage.approveVersion.useMutation({
    onSuccess: () => {
      toast.success("Formula approved.");
      void utils.beverage.listPending.invalidate();
      void utils.beverage.listApproved.invalidate();
    },
    onError: error => toast.error(humanError(error.message)),
  });

  const scale = trpc.beverage.scale.useMutation({
    onSuccess: result => setScaleResult(result),
    onError: error => {
      setScaleResult(null);
      toast.error(humanError(error.message));
    },
  });

  const draftRows = (drafts.data ?? []) as FormulaDraft[];
  const crmRows = (crmRecipes.data ?? []) as CrmRecipe[];
  const pendingRows = (pending.data ?? []) as FormulaVersion[];
  const approvedRows = (approved.data ?? []) as FormulaVersion[];

  // Rebuilt only when the two lists change; every draft row resolves against it.
  const catalog = useMemo(
    () => buildCatalog(approvedRows, draftRows),
    [approvedRows, draftRows]
  );

  const selectedApproved = useMemo(
    () => approvedRows.find(f => f.id === scaleTarget) ?? null,
    [approvedRows, scaleTarget]
  );

  function openNormalize(draft: FormulaDraft) {
    setNormalizing(draft);
    setFormulaName(cleanFormulaName(draft.name));
    setYieldValue("");
    setYieldUnit(draft.intended_yield_unit ?? "L");
    const resolved = resolveDraftIngredients(draft, catalog, crmRows);
    setResolution(resolved);
    setComponents(componentsFrom(resolved));
    // When the CRM backs this recipe it is the source of truth for the whole
    // recipe, method included, so its wording wins over the intake's. Otherwise
    // the intake text is prefilled — empty for a syrup, which carries no method
    // at all, so that is the normal case rather than a failure.
    setMethodSteps(
      parseMethodDraft(resolved.crmRecipe?.method ?? draft.method_source_text)
    );
  }

  function submitVersion() {
    if (!normalizing) return;
    // A planned yield is optional — for a new build it is not known until a
    // batch has been made. Blank means absent, not empty string.
    const plannedValue = yieldValue.trim();
    const plannedUnit = yieldUnit.trim();
    createVersion.mutate({
      formulaDraftId: normalizing.id,
      formulaKey: slugify(formulaName),
      name: formulaName.trim(),
      yieldValue: plannedValue === "" ? undefined : plannedValue,
      yieldUnit: plannedValue === "" || plannedUnit === "" ? undefined : plannedUnit,
      components: components.map((c, index) => ({
        line_number: index + 1,
        ingredient_name: c.ingredient_name.trim(),
        quantity: c.quantity.trim(),
        unit: c.unit.trim(),
      })),
      // Blank rows are dropped here rather than sent, so an operator who adds a
      // step and changes their mind is not refused by the database.
      processSteps: methodSteps
        .filter(step => step.text.trim() !== "")
        .map(step => ({
          section: step.section?.trim() || null,
          text: step.text.trim(),
        })),
    });
  }

  function runScale() {
    if (!selectedApproved) return;
    const request =
      scaleMode === "multiplier"
        ? ({ mode: "multiplier", multiplier } as const)
        : scaleMode === "targetYield"
          ? ({ mode: "targetYield", targetYieldValue: targetYield } as const)
          : ({
              mode: "limitingIngredient",
              ingredientName: limitIngredient,
              availableQuantity: limitQuantity,
              unit: limitUnit,
            } as const);

    scale.mutate({ formulaVersionId: selectedApproved.id, request, record: false });
  }

  if (hasSession !== true || context.isPending) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (context.error) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-6">
        <Card className="p-8 max-w-lg text-center">
          <p className="text-neutral-900 font-medium">
            This workbench is not available to your account yet.
          </p>
          <p className="text-sm text-neutral-600 mt-2">{context.error.message}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-semibold text-neutral-900">
              Beverage Intelligence
            </h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-neutral-600">
            <span>{context.data?.organization_name}</span>
            <Badge variant="secondary">{context.data?.role}</Badge>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-6 py-8">
        <Tabs defaultValue="drafts">
          <TabsList>
            <TabsTrigger value="drafts">Drafts ({draftRows.length})</TabsTrigger>
            <TabsTrigger value="pending">
              Awaiting approval ({pendingRows.length})
            </TabsTrigger>
            <TabsTrigger value="approved">
              Approved &amp; scale ({approvedRows.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="drafts" className="mt-6">
            <Card className="bg-white border-neutral-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Planned yield</TableHead>
                    <TableHead>Ingredients</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draftRows.map(draft => {
                    const resolved = resolveDraftIngredients(draft, catalog, crmRows);
                    const usable = componentsFrom(resolved);
                    const missing = resolved.items.filter(
                      i => i.role === "ingredient" && i.quantity === null
                    ).length;
                    return (
                      <TableRow key={draft.id}>
                        <TableCell className="font-medium">{draft.name}</TableCell>
                        <TableCell className="text-neutral-600">
                          {draft.product_category}
                        </TableCell>
                        <TableCell className="text-neutral-600">
                          {draft.intended_yield_value ?? "—"}{" "}
                          {draft.intended_yield_unit ?? ""}
                        </TableCell>
                        <TableCell>
                          {usable.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 text-sm">
                              <TriangleAlert className="w-4 h-4" /> no ingredient list
                            </span>
                          ) : missing > 0 ? (
                            // Named, but not yet measurable. Saying which of the
                            // two it is matters: one needs a source fix, the
                            // other needs somebody to type the quantities.
                            <span className="inline-flex items-center gap-1 text-amber-600 text-sm">
                              <TriangleAlert className="w-4 h-4" />
                              {usable.length} named, {missing}{" "}
                              {missing === 1 ? "needs" : "need"} a quantity
                            </span>
                          ) : (
                            <span className="text-neutral-600">{usable.length}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={usable.length === 0}
                            onClick={() => openNormalize(draft)}
                          >
                            Normalize
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="pending" className="mt-6 space-y-4">
            {pendingRows.length === 0 ? (
              <Card className="p-8 text-center text-neutral-600 bg-white">
                Nothing is awaiting approval.
              </Card>
            ) : (
              pendingRows.map(version => (
                <Card key={version.id} className="p-6 bg-white border-neutral-200">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-neutral-900">
                        {version.name}{" "}
                        <span className="text-neutral-500 font-normal">
                          v{version.version_number}
                        </span>
                      </h3>
                      <p className="text-sm text-neutral-600 mt-1">
                        {version.intended_yield_value
                          ? `Planned yield ${version.intended_yield_value} ${version.intended_yield_unit ?? ""}`
                          : "Yield not recorded yet"}
                      </p>
                    </div>
                    <Badge variant="outline">draft</Badge>
                  </div>

                  <ul className="mt-4 text-sm text-neutral-700 space-y-1">
                    {version.components.map(c => (
                      <li key={c.line_number}>
                        {c.ingredient_name} — {c.quantity} {c.unit}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 space-y-2">
                    <Label htmlFor={`rationale-${version.id}`}>
                      Approval rationale (required)
                    </Label>
                    <Textarea
                      id={`rationale-${version.id}`}
                      value={rationale[version.id] ?? ""}
                      onChange={e =>
                        setRationale(prev => ({ ...prev, [version.id]: e.target.value }))
                      }
                      placeholder="What did you check against the source?"
                    />
                    <Button
                      onClick={() =>
                        approveVersion.mutate({
                          formulaVersionId: version.id,
                          rationale: rationale[version.id] ?? "",
                        })
                      }
                      disabled={approveVersion.isPending}
                    >
                      {approveVersion.isPending && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      Approve
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="approved" className="mt-6 space-y-6">
            <Card className="p-6 bg-white border-neutral-200 space-y-4">
              <div className="space-y-2">
                <Label>Approved formula</Label>
                <Select value={scaleTarget} onValueChange={setScaleTarget}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an approved formula" />
                  </SelectTrigger>
                  <SelectContent>
                    {approvedRows.map(f => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name} v{f.version_number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Scale by</Label>
                <Select
                  value={scaleMode}
                  onValueChange={value => setScaleMode(value as typeof scaleMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiplier">Exact multiplier</SelectItem>
                    <SelectItem value="targetYield">Target yield</SelectItem>
                    <SelectItem value="limitingIngredient">
                      What I have on hand
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {scaleMode === "multiplier" && (
                <div className="space-y-2">
                  <Label htmlFor="multiplier">Multiplier</Label>
                  <Input
                    id="multiplier"
                    value={multiplier}
                    onChange={e => setMultiplier(e.target.value)}
                  />
                </div>
              )}

              {scaleMode === "targetYield" && (
                <div className="space-y-2">
                  <Label htmlFor="targetYield">
                    Target yield ({selectedApproved?.intended_yield_unit ?? "unit"})
                  </Label>
                  <Input
                    id="targetYield"
                    value={targetYield}
                    onChange={e => setTargetYield(e.target.value)}
                  />
                </div>
              )}

              {scaleMode === "limitingIngredient" && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Ingredient</Label>
                    <Select value={limitIngredient} onValueChange={setLimitIngredient}>
                      <SelectTrigger>
                        <SelectValue placeholder="Which one is short?" />
                      </SelectTrigger>
                      <SelectContent>
                        {(selectedApproved?.components ?? []).map(c => (
                          <SelectItem key={c.line_number} value={c.ingredient_name}>
                            {c.ingredient_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="limitQuantity">I have</Label>
                    <Input
                      id="limitQuantity"
                      value={limitQuantity}
                      onChange={e => setLimitQuantity(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="limitUnit">Unit</Label>
                    <Input
                      id="limitUnit"
                      value={limitUnit}
                      onChange={e => setLimitUnit(e.target.value)}
                      placeholder="must match the formula"
                    />
                  </div>
                </div>
              )}

              <Button
                onClick={runScale}
                disabled={!selectedApproved || scale.isPending}
              >
                {scale.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Scale
              </Button>
            </Card>

            {scaleResult && (
              <Card className="p-6 bg-white border-neutral-200">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <h3 className="font-semibold text-neutral-900">
                    {scaleResult.name}
                  </h3>
                  <Badge variant="outline">{scaleResult.status}</Badge>
                </div>

                <p className="mt-2 text-sm text-neutral-600">
                  Factor{" "}
                  <span className="font-mono text-neutral-900">
                    {scaleResult.factor.exact}
                  </span>{" "}
                  ({readable(scaleResult.factor.decimal, scaleResult.factor.decimalIsExact)})
                  {!scaleResult.factor.decimalIsExact && (
                    <Badge variant="secondary" className="ml-2">
                      decimal truncated
                    </Badge>
                  )}
                </p>

                {scaleResult.scaledYield && (
                  <p className="text-sm text-neutral-600">
                    Scaled yield{" "}
                    {readable(scaleResult.scaledYield.value, scaleResult.scaledYield.isExact)}{" "}
                    {scaleResult.scaledYield.unit}
                  </p>
                )}

                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead>Original</TableHead>
                      <TableHead>Scaled</TableHead>
                      <TableHead>Exact value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scaleResult.components.map(c => (
                      <TableRow key={c.lineNumber}>
                        <TableCell className="font-medium">{c.ingredientName}</TableCell>
                        <TableCell className="text-neutral-600">
                          {c.originalQuantity} {c.unit}
                        </TableCell>
                        <TableCell className="font-mono">
                          {readable(c.scaledQuantity, c.scaledQuantityIsExact)} {c.unit}
                        </TableCell>
                        <TableCell className="font-mono text-neutral-600">
                          {c.scaledQuantityIsExact ? (
                            <Badge variant="secondary">exact</Badge>
                          ) : (
                            c.scaledQuantityExact
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Dialog
        open={normalizing !== null}
        onOpenChange={open => !open && setNormalizing(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Normalize into a formula version</DialogTitle>
            <DialogDescription>
              The source draft is preserved. This creates a new version that still
              requires approval before it can be scaled.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="formulaName">Name</Label>
                <Input
                  id="formulaName"
                  value={formulaName}
                  onChange={e => setFormulaName(e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="yieldValue">Planned yield (optional)</Label>
                <Input
                  id="yieldValue"
                  value={yieldValue}
                  placeholder="leave blank until you have made a batch"
                  onChange={e => setYieldValue(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="yieldUnit">Unit</Label>
                <Input
                  id="yieldUnit"
                  value={yieldUnit}
                  onChange={e => setYieldUnit(e.target.value)}
                />
              </div>
            </div>

            {resolution?.crmRecipe && (
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
                Ingredients, quantities, units and method come from the CRM
                recipe <span className="font-medium">{resolution.crmRecipe.name}</span>.
                Editing them here changes this formula version only — the CRM
                recipe is never written back to.
              </div>
            )}

            {resolution?.blockedReason && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {resolution.blockedReason}
              </div>
            )}

            {resolution && resolution.items.some(i => i.issues.length > 0) && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  What the source did not give us
                </Label>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {resolution.items
                    .filter(i => i.issues.length > 0)
                    .map((item, index) => (
                      <li key={index}>
                        <span className="font-medium">{item.name}</span>
                        {" — "}
                        {item.issues.map(issueText).join("; ")}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {resolution && resolution.items.some(i => i.role === "garnish") && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Garnish (not a measured component)
                </Label>
                <p className="text-xs text-muted-foreground">
                  {resolution.items
                    .filter(i => i.role === "garnish")
                    .map(i => i.name)
                    .join(", ")}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Components</Label>
              {components.map((component, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                  <Input
                    value={component.ingredient_name}
                    placeholder="Ingredient"
                    onChange={e =>
                      setComponents(prev =>
                        prev.map((c, i) =>
                          i === index ? { ...c, ingredient_name: e.target.value } : c
                        )
                      )
                    }
                  />
                  <Input
                    value={component.quantity}
                    placeholder="Qty"
                    onChange={e =>
                      setComponents(prev =>
                        prev.map((c, i) =>
                          i === index ? { ...c, quantity: e.target.value } : c
                        )
                      )
                    }
                  />
                  <Input
                    value={component.unit}
                    placeholder="Unit"
                    onChange={e =>
                      setComponents(prev =>
                        prev.map((c, i) =>
                          i === index ? { ...c, unit: e.target.value } : c
                        )
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setComponents(prev => prev.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setComponents(prev => [
                    ...prev,
                    { ingredient_name: "", quantity: "", unit: "" },
                  ])
                }
              >
                <Plus className="w-4 h-4 mr-1" /> Add component
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Preparation method</Label>
              <p className="text-xs text-muted-foreground">
                {resolution?.crmRecipe?.method
                  ? "Prefilled from the CRM recipe. Correct it before creating the version — these steps are what gets approved, and the CRM is not written back to."
                  : normalizing?.method_source_text
                    ? "Prefilled from the recipe intake. Correct it before creating the version — these steps are what gets approved."
                    : "Nothing came from the intake for this one. Type the method if you know it; leaving it blank records no method rather than a guessed one."}
              </p>
              {methodSteps.map((step, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[1fr_3fr_auto]">
                  <Input
                    value={step.section ?? ""}
                    placeholder="Section"
                    onChange={e =>
                      setMethodSteps(prev =>
                        prev.map((m, i) =>
                          i === index
                            ? { ...m, section: e.target.value || null }
                            : m
                        )
                      )
                    }
                  />
                  <Input
                    value={step.text}
                    placeholder={`Step ${index + 1}`}
                    onChange={e =>
                      setMethodSteps(prev =>
                        prev.map((m, i) =>
                          i === index ? { ...m, text: e.target.value } : m
                        )
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setMethodSteps(prev => prev.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setMethodSteps(prev => [
                    ...prev,
                    // A new step inherits the last section, so continuing
                    // "TO BATCH" does not mean retyping the heading.
                    { section: prev[prev.length - 1]?.section ?? null, text: "" },
                  ])
                }
              >
                <Plus className="w-4 h-4 mr-1" /> Add step
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setNormalizing(null)}>
              Cancel
            </Button>
            <Button onClick={submitVersion} disabled={createVersion.isPending}>
              {createVersion.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Create version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Shape helper so the result state is typed without importing server code. */
function scaleResultShape() {
  return {
    formulaVersionId: "",
    name: "",
    status: "not_released" as const,
    factor: { exact: "", decimal: "", decimalIsExact: true },
    scaledYield: null as { value: string; unit: string | null; isExact: boolean } | null,
    components: [] as Array<{
      lineNumber: number;
      ingredientName: string;
      unit: string;
      originalQuantity: string | number;
      scaledQuantity: string;
      scaledQuantityIsExact: boolean;
      scaledQuantityExact?: string;
    }>,
  };
}
