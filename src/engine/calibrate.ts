import { expit, logit } from "./dist";
import type { Registry } from "./registry";
import { resolve, roll } from "./roll";
import type { Person } from "./types";

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
