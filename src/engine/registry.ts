import type { GeoEntry, Source, TraitId, TraitSpec } from "./types";

export interface Registry {
  version: string;
  traits: Map<TraitId, TraitSpec>;
  /** Trait ids in sampling order: every trait comes after all of its parents. */
  order: TraitId[];
  geo: Record<string, GeoEntry>;
  sources: Record<string, Source>;
}

export function buildRegistry(specs: TraitSpec[], geo: Record<string, GeoEntry>, sources: Record<string, Source>): Registry {
  const traits = new Map(specs.map((s) => [s.id, s]));
  for (const s of specs) {
    for (const p of s.parents) {
      const parent = traits.get(p);
      if (!parent) throw new Error(`${s.id}: parent ${p} is not in the registry`);
      if (parent.tier > s.tier) throw new Error(`${s.id} (tier ${s.tier}) depends on ${p} (tier ${parent.tier})`);
    }
    for (const id of s.source_ids) if (!sources[id]) throw new Error(`${s.id}: unknown source ${id}`);
  }
  // Kahn's algorithm, ties broken by (tier, id) so the order is stable.
  const remaining = new Map(specs.map((s) => [s.id, new Set(s.parents)]));
  const order: TraitId[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([id]) => id)
      .sort((a, b) => traits.get(a)!.tier - traits.get(b)!.tier || a.localeCompare(b));
    if (!ready.length) throw new Error(`Dependency cycle among: ${[...remaining.keys()].join(", ")}`);
    const id = ready[0];
    order.push(id);
    remaining.delete(id);
    for (const deps of remaining.values()) deps.delete(id);
  }
  const version = specs.map((s) => `${s.id}@${s.version}`).sort().join(",");
  return { version: hash(version), traits, order, geo, sources };
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}
