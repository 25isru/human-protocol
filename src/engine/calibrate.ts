import { expit, logit } from "./dist";
import type { Registry } from "./registry";
import { resolve, roll } from "./roll";
import type { Person, TraitSpec } from "./types";

/**
 * Solves the calibration offset for a yes/no trait with modifiers, so that the population rate
 * after modifiers equals the sourced baseline rate. Works by simulating people and bisecting.
 */
export function solveOffset(reg: Registry, traitId: string, n = 50000, seed = "calibrate"): { offset: number; target: number; before: number } {
  const spec = reg.traits.get(traitId)!;
  if (spec.baseline?.dist_kind !== "bernoulli") throw new Error("Only yes/no traits are supported so far");
  const zero = { ...spec, calibration_offset: 0 };
  const unmodified = { ...zero, modifiers: [] };
  const pairs: { base: number; shift: number }[] = [];
  for (let i = 0; i < n; i++) {
    const profile = roll(reg, { seed: `${seed}-${i}` });
    const person: Person = Object.fromEntries(Object.entries(profile.traits).map(([k, v]) => [k, v.value]));
    if (!profile.traits[traitId].trace.applicable) continue;
    const base = resolve(unmodified, person, reg);
    const full = resolve(zero, person, reg);
    if (!base || !full || base.dist.kind !== "bernoulli" || full.dist.kind !== "bernoulli") continue;
    pairs.push({ base: base.dist.p, shift: logit(full.dist.p) - logit(base.dist.p) });
  }
  const mean = (c: number) => pairs.reduce((s, p) => s + expit(logit(p.base) + p.shift + c), 0) / pairs.length;
  const target = pairs.reduce((s, p) => s + p.base, 0) / pairs.length;
  let lo = -5, hi = 5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mean(mid) > target) hi = mid; else lo = mid;
  }
  return { offset: Math.round(((lo + hi) / 2) * 1e4) / 1e4, target, before: mean(0) };
}

/**
 * Solves per-row offsets for a categorical trait with adjustments, so that within each table row
 * (e.g. each country) the population's shares after adjustments still equal the sourced row.
 * Rows whose keys are all root traits are sampled by fixing those traits; the rest use an unconditional sample.
 */
export function solveCategoricalOffsets(reg: Registry, traitId: string, perRow = 4000, seed = "calibrate"): Record<string, number[]> {
  const spec = reg.traits.get(traitId)!;
  const b = spec.baseline!;
  if (b.dist_kind !== "categorical") throw new Error("Not a categorical trait");
  const zero: TraitSpec = { ...spec, baseline: { ...b, calibration: undefined } };
  const plain: TraitSpec = { ...zero, modifiers: [] };
  const rootKeys = b.keys.every((k) => reg.traits.get(k)!.parents.length === 0);
  const shiftsByRow = new Map<string, number[][]>();
  const collect = (pins: Record<string, string>, i: number) => {
    const profile = roll(reg, { seed: `${seed}-${traitId}-${JSON.stringify(pins)}-${i}`, pins });
    if (!profile.traits[traitId].trace.applicable) return;
    const person: Person = Object.fromEntries(Object.entries(profile.traits).map(([k, v]) => [k, v.value]));
    const base = resolve(plain, person, reg), full = resolve(zero, person, reg);
    if (!base || !full || base.dist.kind !== "categorical" || full.dist.kind !== "categorical") return;
    // Recover the un-normalised log shift per category from the two distributions.
    const bp = base.dist.p, fp = full.dist.p;
    const ref = bp.findIndex((p) => p > 0);
    const shift = bp.map((p, k) => (p > 0 ? Math.log(fp[k] / p) - Math.log(fp[ref] / bp[ref]) : 0));
    const list = shiftsByRow.get(base.key) ?? [];
    list.push(shift);
    shiftsByRow.set(base.key, list);
  };
  if (rootKeys) {
    for (const key of Object.keys(b.table)) {
      const parts = key.split("|");
      if (parts.some((x) => x === "W" || x.startsWith("S:") || x.startsWith("R:"))) continue;
      const pins = Object.fromEntries(b.keys.map((k, i) => [k, parts[i]]));
      for (let i = 0; i < perRow; i++) collect(pins, i);
    }
  }
  for (let i = 0; i < perRow * 25; i++) collect({}, i); // covers fallback rows and non-root keys
  const out: Record<string, number[]> = {};
  for (const [key, shifts] of shiftsByRow) {
    const target = b.table[key];
    if (!target || shifts.length < 200) continue;
    const c = target.map(() => 0);
    for (let iter = 0; iter < 200; iter++) {
      const mean = target.map(() => 0);
      for (const d of shifts) {
        const z = target.map((p, k) => (p > 0 ? p * Math.exp(d[k] + c[k]) : 0));
        const total = z.reduce((s, x) => s + x, 0);
        z.forEach((x, k) => (mean[k] += x / total / shifts.length));
      }
      target.forEach((p, k) => { if (p > 0 && mean[k] > 0) c[k] += Math.log(p / mean[k]); });
    }
    const ref = c[target.findIndex((p) => p > 0)];
    out[key] = c.map((x, k) => (target[k] > 0 ? Math.round((x - ref) * 1e4) / 1e4 : 0));
  }
  return out;
}
