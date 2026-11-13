import { expit, inverseCdf, likelihood, logit, percentile } from "./dist";
import type { Registry } from "./registry";
import { randomSeed, stream } from "./rng";
import type { ConditionalTable, Dist, Grade, Person, Predicate, Profile, RollRequest, RolledTrait, Trace, TraitSpec, Value } from "./types";

const GRADES: Grade[] = ["A", "B", "C", "D"];
const LOG_ODDS_CAP = 3;
const PARTICLES = 400;

export function evaluate(pred: Predicate, person: Person): boolean {
  if ("all" in pred) return pred.all.every((p) => evaluate(p, person));
  if ("any" in pred) return pred.any.some((p) => evaluate(p, person));
  if ("not" in pred) return !evaluate(pred.not, person);
  const v = person[pred.trait];
  if (v === null || v === undefined) return false;
  switch (pred.op) {
    case "eq": return v === pred.value;
    case "in": return (pred.value as unknown[]).includes(v);
    case "gte": return Number(v) >= Number(pred.value);
    case "lt": return Number(v) < Number(pred.value);
  }
}

function derive(spec: TraitSpec, person: Person, reg: Registry): Value {
  const d = spec.derive!;
  switch (d.fn) {
    case "birth_year": return d.as_of - Number(person["frame.age"]);
    case "age_group5": {
      const a = Number(person["frame.age"]);
      return a >= 100 ? "100+" : `${Math.floor(a / 5) * 5}--${Math.floor(a / 5) * 5 + 4}`;
    }
    case "cohort5": return String(Math.floor(Number(person["frame.birth_year"]) / 5) * 5);
    case "geo": return reg.geo[String(person["frame.country"])]?.[d.field] ?? null;
  }
}

/** Finds the table row for a person, relaxing keys in the declared backoff order when needed. */
export function lookup(table: ConditionalTable, person: Person, reg: Registry) {
  const exact = table.keys.map((k) => String(person[k]));
  const alternatives: string[][] = exact.map((v) => [v]);
  // Search order: relax the first backoff step fully before touching the next one.
  const loopOrder: number[] = [];
  for (const step of table.backoff) {
    const i = table.keys.indexOf(step.key);
    if (i < 0) continue;
    loopOrder.push(i);
    if (step.via === "geo_hierarchy") {
      const g = reg.geo[exact[i]];
      if (g) alternatives[i] = [exact[i], `S:${g.subregion}`, `R:${g.region}`, "W"];
    } else {
      const x = Number(exact[i]);
      alternatives[i] = [exact[i], ...step.order.filter((o) => o !== exact[i]).sort((a, b) => Math.abs(Number(a) - x) - Math.abs(Number(b) - x))];
    }
  }
  const current = [...exact];
  const search = (depth: number): number[] | undefined => {
    if (depth < 0) return table.table[current.join("|")];
    const i = loopOrder[depth];
    for (const alt of alternatives[i]) {
      current[i] = alt;
      const row = search(depth - 1);
      if (row) return row;
    }
    current[i] = exact[i];
    return undefined;
  };
  const row = search(loopOrder.length - 1);
  if (!row) return undefined;
  const stratum: Record<string, string> = {};
  const steps: Trace["backoff_steps"] = [];
  table.keys.forEach((k, i) => {
    stratum[k] = current[i];
    if (current[i] !== exact[i]) steps.push({ key: k, from: exact[i], to: current[i] });
  });
  return { row, stratum, steps };
}

function baseDist(spec: TraitSpec, row: number[]): Dist {
  switch (spec.baseline!.dist_kind) {
    case "bernoulli": return { kind: "bernoulli", p: row[0] };
    case "categorical": return { kind: "categorical", categories: spec.categories!, p: row };
    case "normal": return { kind: "normal", mean: row[0], sd: row[1], min: spec.support?.min, max: spec.support?.max };
  }
}

/** Applies active modifiers and the calibration offset to a baseline distribution. */
export function compose(spec: TraitSpec, base: Dist, person: Person, conditioned: Set<string>) {
  const active = spec.modifiers.filter((m) => evaluate(m.when, person) && !predicateTraits(m.when).every((t) => conditioned.has(t)));
  const groupCount = new Map<string, number>();
  for (const m of active) if (m.overlap_group) groupCount.set(m.overlap_group, (groupCount.get(m.overlap_group) ?? 0) + 1);
  const applied = active.map((m) => {
    const overlapping = m.overlap_group && groupCount.get(m.overlap_group)! > 1 && !(m.adjusted_for?.length);
    const beta = m.effect.kind === "log_odds" ? m.effect.beta : m.effect.kind === "mean_shift" ? m.effect.delta : m.effect.factor;
    return { m, weight: overlapping ? 0.5 : 1, beta };
  });
  const offset = spec.calibration_offset ?? 0;
  let dist: Dist = base;
  if (base.kind === "bernoulli") {
    const shift = applied.reduce((s, a) => s + (a.m.effect.kind === "log_odds" ? a.weight * a.beta : 0), 0);
    const capped = Math.max(-LOG_ODDS_CAP, Math.min(LOG_ODDS_CAP, shift));
    if (applied.length || offset) dist = { kind: "bernoulli", p: expit(logit(clampP(base.p)) + offset + capped) };
  } else if (base.kind === "categorical") {
    if (applied.length) {
      const logp = base.p.map((p) => Math.log(Math.max(p, 1e-12)));
      for (const a of applied) {
        if (a.m.effect.kind !== "log_odds" || !a.m.effect.category) continue;
        const i = base.categories.indexOf(a.m.effect.category);
        if (i >= 0) logp[i] += Math.max(-LOG_ODDS_CAP, Math.min(LOG_ODDS_CAP, a.weight * a.beta));
      }
      const z = logp.map(Math.exp);
      const total = z.reduce((s, x) => s + x, 0);
      dist = { ...base, p: z.map((x) => x / total) };
    }
  } else {
    let mean = base.mean + offset, sd = base.sd;
    for (const a of applied) {
      if (a.m.effect.kind === "mean_shift") mean += a.weight * a.beta * (a.m.effect.scale === "sd" ? base.sd : 1);
      if (a.m.effect.kind === "sd_scale") sd *= a.beta;
    }
    dist = { ...base, mean, sd };
  }
  return { dist, applied };
}

const clampP = (p: number) => Math.min(Math.max(p, 1e-9), 1 - 1e-9);

function predicateTraits(p: Predicate): string[] {
  if ("all" in p) return p.all.flatMap(predicateTraits);
  if ("any" in p) return p.any.flatMap(predicateTraits);
  if ("not" in p) return predicateTraits(p.not);
  return [p.trait];
}

function worstGrade(grades: Grade[], bump: number): Grade {
  const i = Math.max(...grades.map((g) => GRADES.indexOf(g)));
  return GRADES[Math.min(i + bump, GRADES.length - 1)];
}

function coerce(spec: TraitSpec, raw: string | number | boolean): Value {
  if (spec.value_type === "continuous") return Math.round(Number(raw) * 10) / 10;
  if (spec.numeric) return Number(raw);
  return raw;
}

/** Resolves the final distribution of one trait for a person (no sampling). */
export function resolve(spec: TraitSpec, person: Person, reg: Registry) {
  const found = lookup(spec.baseline!, person, reg);
  if (!found) return undefined;
  const { dist, applied } = compose(spec, baseDist(spec, found.row), person, new Set(Object.keys(found.stratum)));
  return { ...found, dist, applied };
}

/** One full pass over the registry. Returns the traits and the likelihood weight of the pinned values. */
function pass(reg: Registry, seed: string, pins: Record<string, Value>): { traits: Record<string, RolledTrait>; weight: number; logProb: number } {
  const person: Person = {};
  const traits: Record<string, RolledTrait> = {};
  let weight = 1, logProb = 0;
  for (const id of reg.order) {
    const spec = reg.traits.get(id)!;
    const trace: Trace = {
      applicable: true, pinned: false, derived: false, stratum: {}, backoff_steps: [], modifiers: [],
      calibration_offset: spec.calibration_offset ?? 0, dist: null, grade: spec.grade, source_ids: [...spec.source_ids],
    };
    let value: Value = null;
    if (spec.applies_when && !evaluate(spec.applies_when, person)) {
      trace.applicable = false;
      if (id in pins) weight = 0;
    } else if (spec.derive) {
      trace.derived = true;
      value = derive(spec, person, reg);
    } else {
      const r = resolve(spec, person, reg);
      if (!r) {
        trace.missing_data = true;
        if (id in pins) { value = pins[id]; trace.pinned = true; }
      } else {
        trace.stratum = r.stratum;
        trace.backoff_steps = r.steps;
        trace.dist = r.dist;
        trace.modifiers = r.applied.map((a) => ({ id: a.m.id, beta: a.beta, weight: a.weight, mechanism: a.m.mechanism, rationale: a.m.rationale }));
        trace.grade = worstGrade([spec.grade, ...r.applied.map((a) => a.m.grade)], r.steps.length);
        for (const a of r.applied) for (const s of a.m.source_ids) if (!trace.source_ids.includes(s)) trace.source_ids.push(s);
        if (id in pins) {
          value = pins[id];
          trace.pinned = true;
          weight *= likelihood(r.dist, value);
        } else {
          const u = stream(seed, id)();
          trace.u = u;
          value = coerce(spec, inverseCdf(r.dist, u));
        }
        const like = likelihood(r.dist, value);
        if (r.dist.kind !== "normal") trace.probability = like;
        trace.percentile = percentile(r.dist, value);
        if (!trace.pinned && like > 0) logProb += Math.log(like);
      }
    }
    person[id] = value;
    traits[id] = { value, trace };
  }
  return { traits, weight, logProb };
}

/**
 * Rolls one person. With no pins this is a single forward pass.
 * Pins are handled by likelihood weighting: many candidates are rolled with the pinned values forced,
 * each weighted by how probable those values were, and one is picked in proportion to its weight.
 * That keeps upstream traits realistic, e.g. pinning age 80 makes older-population countries more likely.
 */
export function roll(reg: Registry, request: RollRequest = {}): Profile {
  const seed = request.seed ?? randomSeed();
  const pins = request.pins ?? {};
  for (const id of Object.keys(pins)) if (!reg.traits.has(id)) throw new Error(`Unknown pinned trait: ${id}`);
  const needsWeighting = Object.keys(pins).some((id) => reg.traits.get(id)!.parents.length > 0);
  let chosen: ReturnType<typeof pass>;
  if (!needsWeighting) {
    chosen = pass(reg, seed, pins);
    if (chosen.weight === 0) throw new Error("That combination of fixed values is impossible.");
  } else {
    const candidates = Array.from({ length: PARTICLES }, (_, k) => pass(reg, `${seed}/${k}`, pins));
    const total = candidates.reduce((s, c) => s + c.weight, 0);
    if (total === 0) throw new Error("That combination of fixed values is impossible or too rare to roll.");
    let target = stream(seed, "pin-select")() * total;
    chosen = candidates[candidates.length - 1];
    for (const c of candidates) {
      target -= c.weight;
      if (target <= 0) { chosen = c; break; }
    }
  }
  return { seed, registry_version: reg.version, pins, traits: chosen.traits, log_prob: chosen.logProb };
}
