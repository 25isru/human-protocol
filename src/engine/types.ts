// Data structures for the Human Protocol engine (stage 1).
// These follow the protocol document's TraitSpec, with one practical change:
// conditional tables are stored as compact keyed rows instead of one object per stratum.

export type TraitId = string;
export type Grade = "A" | "B" | "C" | "D";
export type Value = string | number | boolean | null;
export type Person = Record<TraitId, Value>;

export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { trait: TraitId; op: "eq" | "in" | "gte" | "lt"; value: unknown };

export type BackoffStep =
  | { key: TraitId; via: "geo_hierarchy" }
  | { key: TraitId; via: "nearest"; order: string[] };

/** Row layout by dist_kind: categorical = probabilities per category; bernoulli = [p]; normal = [mean, sd]. */
export interface ConditionalTable {
  keys: TraitId[];
  backoff: BackoffStep[];
  dist_kind: "categorical" | "bernoulli" | "normal";
  table: Record<string, number[]>;
  /** Per-row log offsets per category, solved by `npm run calibrate`, so adjustments keep each row's sourced shares. */
  calibration?: Record<string, number[]>;
}

export type Dist =
  | { kind: "bernoulli"; p: number }
  | { kind: "categorical"; categories: string[]; p: number[] }
  | { kind: "normal"; mean: number; sd: number; min?: number; max?: number };

export interface Modifier {
  id: string;
  when: Predicate;
  effect:
    | { kind: "log_odds"; category?: string; beta: number }
    | { kind: "category_shift"; betas: Record<string, number> } // log multipliers for several categories at once
    | { kind: "mean_shift"; delta: number; scale: "unit" | "sd" }
    | { kind: "sd_scale"; factor: number };
  ci95?: [number, number];
  /** Required when ci95 is absent: why the source gives no interval. */
  no_ci_reason?: string;
  adjusted_for?: TraitId[];
  overlap_group?: string;
  mechanism: "genetic" | "environmental" | "social" | "measurement" | "unknown";
  source_ids: string[];
  grade: Grade;
  rationale: string;
}

export type Derive =
  | { fn: "birth_year"; as_of: number }
  | { fn: "age_group5" }
  | { fn: "cohort5" }
  | { fn: "geo"; field: "subregion" | "region" }
  | { fn: "bins"; from: TraitId; edges: number[]; labels: string[] }; // labels[i] covers values below edges[i]; the last label covers the rest

export interface TraitSpec {
  id: TraitId;
  version: number;
  label: string;
  definition: string;
  tier: number;
  value_type: "boolean" | "categorical" | "ordinal" | "continuous" | "derived";
  unit?: string;
  numeric?: boolean; // categorical whose categories are numbers (age)
  hidden?: boolean; // internal helper trait, not shown on the profile
  categories?: string[];
  category_labels?: Record<string, string>;
  /** Verb phrases for the one-line summary, keyed by value; "*" is a template using {value}. */
  phrases?: Record<string, string>;
  tags?: string[];
  /** What the worldwide fallback row really is, when it is not a true world figure. */
  world_label?: string;
  support?: { min: number; max: number };
  applies_when?: Predicate;
  parents: TraitId[];
  baseline?: ConditionalTable;
  derive?: Derive;
  modifiers: Modifier[];
  calibration_offset?: number;
  ref_year?: number;
  source_ids: string[];
  grade: Grade;
  low_confidence?: boolean;
  assumptions?: { what: string; why: string; grade: Grade }[];
  notes: string[];
}

export interface Source {
  type: string;
  grade: Grade;
  year: number;
  title: string;
  publisher: string;
  url: string;
  retrieved_via: string;
  used_for: string;
}

export interface GeoEntry {
  name: string;
  iso2: string | null;
  subregion: string;
  region: string;
}

export interface RollRequest {
  seed?: string;
  pins?: Record<TraitId, Value>;
}

export interface Trace {
  applicable: boolean;
  pinned: boolean;
  derived: boolean;
  /** Conditioning values actually used, after backoff. */
  stratum: Record<TraitId, string>;
  backoff_steps: { key: TraitId; from: string; to: string }[];
  modifiers: { id: string; beta: number; weight: number; mechanism: string; rationale: string }[];
  calibration_offset: number;
  dist: Dist | null;
  /** Probability of the rolled value (discrete traits) under the final distribution. */
  probability?: number;
  /** Share of the same stratum below this value (continuous traits). */
  percentile?: number;
  u?: number;
  grade: Grade;
  source_ids: string[];
  missing_data?: boolean;
}

export interface RolledTrait {
  value: Value;
  trace: Trace;
}

export interface Profile {
  seed: string;
  registry_version: string;
  pins: Record<TraitId, Value>;
  traits: Record<TraitId, RolledTrait>;
  log_prob: number;
}
