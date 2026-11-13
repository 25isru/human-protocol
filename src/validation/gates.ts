// Validation gates. Every trait must pass these before it is allowed on the site.
// They are trait-agnostic: they read the trait files and the engine's own traces.
import { evaluate, roll } from "../engine/roll";
import type { Registry } from "../engine/registry";
import type { Person, RolledTrait, TraitSpec } from "../engine/types";

export type Status = "pass" | "fail" | "skip";
export interface GateResult { id: string; name: string; status: Status; detail: string }
export interface Example { stratum: Record<string, string>; what: string; expected: number; simulated: number; unit: string; n: number }
export interface TraitReport { id: string; label: string; gates: GateResult[]; examples: Example[] }
export interface ValidationReport {
  registry_version: string;
  people: number;
  traits: TraitReport[];
  summary: { traits: number; passed: number; failed: number };
}

const MIN_GROUP = 400; // smallest simulated group that is checked
const gate = (id: string, name: string, problems: string[], okDetail: string): GateResult =>
  ({ id, name, status: problems.length ? "fail" : "pass", detail: problems.length ? problems.slice(0, 5).join("; ") : okDetail });

function schemaGate(spec: TraitSpec): GateResult {
  const bad: string[] = [];
  if (!spec.label || !spec.definition) bad.push("missing label or definition");
  if (!["A", "B", "C", "D"].includes(spec.grade)) bad.push("invalid evidence grade");
  const b = spec.baseline;
  if (!b && !spec.derive) bad.push("has neither a table nor a derivation rule");
  if (b) {
    const rows = Object.entries(b.table);
    if (!rows.length) bad.push("table is empty");
    for (const k of b.keys) if (!spec.parents.includes(k)) bad.push(`table key ${k} is not declared as a parent`);
    for (const [key, row] of rows) {
      if (key.split("|").length !== Math.max(b.keys.length, 1)) bad.push(`row ${key}: wrong number of keys`);
      if (row.some((x) => !Number.isFinite(x))) bad.push(`row ${key}: not a number`);
      if (b.dist_kind === "categorical") {
        if (row.length !== spec.categories?.length) bad.push(`row ${key}: ${row.length} values for ${spec.categories?.length} categories`);
        if (Math.abs(row.reduce((a, x) => a + x, 0) - 1) > 0.01) bad.push(`row ${key}: probabilities do not sum to 1`);
        if (row.some((x) => x < 0)) bad.push(`row ${key}: negative probability`);
      } else if (b.dist_kind === "bernoulli") {
        if (row[0] < 0 || row[0] > 1) bad.push(`row ${key}: rate outside 0 to 1`);
      } else {
        if (!(row[1] > 0)) bad.push(`row ${key}: spread must be positive`);
        if (spec.support && (row[0] < spec.support.min || row[0] > spec.support.max)) bad.push(`row ${key}: mean outside the allowed range`);
      }
      if (bad.length > 5) break;
    }
    if (b.backoff.some((s) => s.via === "geo_hierarchy") && !rows.some(([k]) => k.split("|").includes("W"))) bad.push("no worldwide fallback row");
  }
  return gate("schema", "Well-formed data", bad, b ? `${Object.keys(b.table).length.toLocaleString("en")} row${Object.keys(b.table).length === 1 ? "" : "s"} checked` : "derived trait");
}

function citationGate(spec: TraitSpec, reg: Registry): GateResult {
  const bad: string[] = [];
  const ids = [...spec.source_ids, ...spec.modifiers.flatMap((m) => m.source_ids)];
  if (spec.baseline && !spec.source_ids.length) bad.push("table has no source");
  for (const id of ids) {
    const s = reg.sources[id];
    if (!s) { bad.push(`unknown source ${id}`); continue; }
    if (!/^https?:\/\//.test(s.url)) bad.push(`${id}: no link`);
    if (!s.title || !s.publisher || !s.used_for) bad.push(`${id}: incomplete citation`);
  }
  if (spec.baseline && !spec.ref_year) bad.push("no reference year");
  for (const a of spec.assumptions ?? []) if (a.grade !== "D" || !a.why) bad.push("an assumption is not graded D with a reason");
  return gate("citation", "Every figure has a source", bad, `${new Set(ids).size} source${new Set(ids).size === 1 ? "" : "s"}`);
}

function effectGate(spec: TraitSpec): GateResult {
  if (!spec.modifiers.length) return { id: "effects", name: "Adjustments within plausible bounds", status: "skip", detail: "no adjustments" };
  const bad: string[] = [];
  for (const m of spec.modifiers) {
    const e = m.effect;
    const size = e.kind === "log_odds" ? Math.abs(e.beta) : e.kind === "mean_shift" ? Math.abs(e.delta) : e.kind === "sd_scale" ? Math.abs(Math.log(e.factor))
      : Math.max(...Object.values(e.betas).map(Math.abs));
    const limit = m.effect.kind === "mean_shift" && m.effect.scale === "sd" ? 2 : 3;
    if (size > limit && m.grade !== "A") bad.push(`${m.id}: effect too large for its evidence grade`);
    if (!m.ci95) { if (!m.no_ci_reason) bad.push(`${m.id}: no confidence interval and no reason given`); }
    else if (m.ci95[0] <= 0 && m.ci95[1] >= 0 && m.effect.kind !== "sd_scale") bad.push(`${m.id}: interval includes no effect`);
    if (!m.rationale || !m.source_ids.length) bad.push(`${m.id}: missing rationale or source`);
  }
  return gate("effects", "Adjustments within plausible bounds", bad, `${spec.modifiers.length} adjustment${spec.modifiers.length === 1 ? "" : "s"}`);
}

const row0sd = (row: number[]) => row[1];

interface Sample { person: Person; traits: Record<string, RolledTrait> }

/** Allowed gap: 1 percentage point or 5% relative (whichever is larger), plus room for sampling noise. */
const tolerance = (p: number, n: number) => Math.max(0.01, 0.05 * p) + 4 * Math.sqrt((p * (1 - p)) / n);

function marginalGate(spec: TraitSpec, samples: Sample[]): { result: GateResult; examples: Example[] } {
  const name = "Simulated population matches the source";
  const b = spec.baseline;
  if (!b) return { result: { id: "marginal", name, status: "skip", detail: "derived trait" }, examples: [] };
  const groups = new Map<string, { stratum: Record<string, string>; values: RolledTrait[] }>();
  for (const s of samples) {
    const t = s.traits[spec.id];
    if (!t.trace.applicable || t.trace.missing_data || t.trace.backoff_steps.length) continue;
    const key = b.keys.map((k) => t.trace.stratum[k]).join("|");
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { stratum: t.trace.stratum, values: [] }));
    g.values.push(t);
  }
  const big = [...groups.entries()].filter(([, g]) => g.values.length >= MIN_GROUP).sort((a, c) => c[1].values.length - a[1].values.length);
  if (!big.length) return { result: { id: "marginal", name, status: "skip", detail: "no group was large enough to check" }, examples: [] };
  const bad: string[] = [];
  const examples: Example[] = [];
  let first: number | undefined;
  const hasModifiers = spec.modifiers.length > 0;
  for (const [key, g] of big) {
    const row = b.table[key];
    const n = g.values.length;
    const push = (what: string, expected: number, simulated: number, unit: string) => { if (examples.length < 6 && !examples.some((e) => JSON.stringify(e.stratum) === JSON.stringify(g.stratum))) examples.push({ stratum: g.stratum, what, expected, simulated, unit, n }); };
    if (b.dist_kind === "normal") {
      const mean = g.values.reduce((s, t) => s + Number(t.value), 0) / n;
      const gap = Math.abs(mean - row[0]) / row[1];
      first ??= gap;
      if (gap > 0.05 + 4 / Math.sqrt(n)) bad.push(`${key}: mean ${mean.toFixed(1)} vs ${row[0]}`);
      push("average", row[0], mean, spec.unit ?? "");
    } else {
      const cats = b.dist_kind === "bernoulli" ? ["true"] : spec.categories!;
      // With adjustments, the right target is the unadjusted rate averaged over the whole group.
      const expected = b.dist_kind === "bernoulli" ? [row[0]] : row;
      let top = 0;
      cats.forEach((c, i) => {
        const got = g.values.filter((t) => String(t.value) === c).length / n;
        const gap = Math.abs(got - expected[i]);
          if (gap > tolerance(expected[i], n)) bad.push(`${key} ${c}: ${(got * 100).toFixed(1)}% vs ${(expected[i] * 100).toFixed(1)}%`);
        if (expected[i] > expected[top]) top = i;
      });
      const got = g.values.filter((t) => String(t.value) === cats[top]).length / n;
      first ??= Math.abs(got - expected[top]);
      push(b.dist_kind === "bernoulli" ? "yes" : cats[top], expected[top] * 100, got * 100, "%");
    }
  }
  const count = `${big.length.toLocaleString("en")} group${big.length === 1 ? "" : "s"} checked, all within the allowed margin`;
  const detail = b.dist_kind === "normal"
    ? `${count}; the largest group is off by ${(first! * row0sd(b.table[big[0][0]])).toFixed(2)} ${spec.unit ?? ""}`
    : `${count}; the largest group is off by ${(first! * 100).toFixed(2)} percentage points${hasModifiers ? " after adjustments and calibration" : ""}`;
  return { result: gate("marginal", name, bad, detail), examples };
}

function conditionalGate(spec: TraitSpec, samples: Sample[]): GateResult {
  const name = "Adjustments reproduce their sourced effect";
  if (!spec.modifiers.length) return { id: "conditional", name, status: "skip", detail: "no adjustments" };
  if (spec.baseline?.dist_kind !== "bernoulli") return { id: "conditional", name, status: "skip", detail: "only checked for yes/no traits so far" };
  const bad: string[] = [];
  const notes: string[] = [];
  for (const m of spec.modifiers) {
    const tally = { on: [0, 0], off: [0, 0] };
    for (const s of samples) {
      const t = s.traits[spec.id];
      if (!t.trace.applicable || t.value === null) continue;
      const side = evaluate(m.when, s.person) ? tally.on : tally.off;
      side[t.value ? 0 : 1]++;
    }
    const or = (tally.on[0] / tally.on[1]) / (tally.off[0] / tally.off[1]);
    const se = Math.sqrt(1 / tally.on[0] + 1 / tally.on[1] + 1 / tally.off[0] + 1 / tally.off[1]);
    const [lo, hi] = m.ci95 ?? [-Infinity, Infinity];
    if (Math.log(or) < lo - 3 * se || Math.log(or) > hi + 3 * se) bad.push(`${m.id}: simulated odds ratio ${or.toFixed(2)} outside ${Math.exp(lo).toFixed(2)} to ${Math.exp(hi).toFixed(2)}`);
    notes.push(`${m.id}: simulated odds ratio ${or.toFixed(2)}, source range ${Math.exp(lo).toFixed(2)} to ${Math.exp(hi).toFixed(2)}`);
  }
  return gate("conditional", name, bad, notes.join("; "));
}

export function runGates(reg: Registry, people = 300_000, seed = "validate"): ValidationReport {
  const samples: Sample[] = [];
  for (let i = 0; i < people; i++) {
    const p = roll(reg, { seed: `${seed}-${i}` });
    samples.push({ traits: p.traits, person: Object.fromEntries(Object.entries(p.traits).map(([k, v]) => [k, v.value])) });
  }
  const traits = reg.order.map((id) => {
    const spec = reg.traits.get(id)!;
    const marginal = marginalGate(spec, samples);
    return {
      id, label: spec.label, examples: marginal.examples,
      gates: [schemaGate(spec), citationGate(spec, reg), effectGate(spec), marginal.result, conditionalGate(spec, samples)],
    };
  });
  const failed = traits.filter((t) => t.gates.some((g) => g.status === "fail")).length;
  return { registry_version: reg.version, people, traits, summary: { traits: traits.length, passed: traits.length - failed, failed } };
}
