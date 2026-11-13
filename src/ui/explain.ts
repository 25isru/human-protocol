// Turns a rolled trait and its trace into plain-language text for the profile card.
import type { Registry } from "../engine/registry";
import type { Profile, RolledTrait, TraitSpec } from "../engine/types";

export const GRADE_LABEL = { A: "Strong evidence", B: "Good evidence", C: "Limited evidence", D: "Rough estimate" } as const;

const pct = (p: number) => {
  const x = p * 100;
  if (x >= 99.95) return "nearly 100%";
  if (x < 0.05) return "under 0.1%";
  return `${x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2)}%`;
};

export function placeName(code: string, reg: Registry): string {
  if (code === "W") return "the world";
  if (code.startsWith("S:") || code.startsWith("R:")) return code.slice(2);
  return reg.geo[code]?.name ?? code;
}

export function flag(iso2: string | null | undefined): string {
  if (!iso2) return "";
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

function feetInches(cm: number): string {
  const totalIn = Math.round(cm / 2.54);
  return `${Math.floor(totalIn / 12)} ft ${totalIn % 12} in`;
}

export function formatValue(spec: TraitSpec, t: RolledTrait, reg: Registry): string {
  const v = t.value;
  if (!t.trace.applicable) return "Not applicable";
  if (v === null) return "No data";
  if (spec.id === "frame.country") return placeName(String(v), reg);
  if (spec.id === "body.height_cm") return `${(v as number).toFixed(1)} cm · ${feetInches(v as number)}`;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (spec.id === "frame.sex") return v === "male" ? "Male" : "Female";
  if (spec.id === "origin.setting") return v === "urban" ? "A town or city" : "The countryside";
  if (spec.category_labels?.[String(v)]) return spec.category_labels[String(v)].replace(/ \(.*\)$/, "");
  if (spec.unit && typeof v === "number") return `${v} ${spec.unit}`;
  return String(v);
}

/** "women aged 30 to 34 in Sweden" from a stratum. */
export function groupLabel(s: Record<string, string>, reg: Registry, sexHint?: string): string {
  const sex = s["frame.sex"] ?? sexHint;
  let who = sex === "male" ? "men" : sex === "female" ? "women" : "people";
  if (s["frame.age_group"]) who += ` aged ${s["frame.age_group"].replace("--", " to ").replace("100+", "100 or over")}`;
  if (s["frame.birth_cohort"]) who += ` born ${s["frame.birth_cohort"]} to ${Number(s["frame.birth_cohort"]) + 4}`;
  if (s["frame.country"]) who += ` in ${placeName(s["frame.country"], reg)}`;
  return who;
}

function group(spec: TraitSpec, t: RolledTrait, reg: Registry, profile: Profile): string {
  return groupLabel(t.trace.stratum, reg, spec.parents.includes("frame.sex") ? String(profile.traits["frame.sex"].value) : undefined);
}

export function explain(spec: TraitSpec, t: RolledTrait, reg: Registry, profile: Profile): string[] {
  const lines: string[] = [];
  const { trace } = t;
  if (!trace.applicable) return [`This is only rolled for people it applies to (${describeCondition(spec)}).`];
  if (trace.derived) return [spec.definition];
  if (trace.missing_data || !trace.dist) return ["No data was available for this person, even after falling back to regional figures."];
  const who = group(spec, t, reg, profile);
  const d = trace.dist;
  if (trace.pinned) lines.push("You fixed this value, so it was not rolled.");

  if (spec.id === "frame.country") {
    lines.push(`${placeName(String(t.value), reg)} is home to ${pct(trace.probability!)} of the world's people, so that is how often a roll lands here.`);
  } else if (spec.id === "frame.sex") {
    lines.push(`${pct(trace.probability!)} of ${who} are ${t.value}.`);
  } else if (spec.id === "frame.age") {
    lines.push(`${pct(trace.probability!)} of ${who} are exactly ${t.value === 100 ? "100 or older" : t.value}.`);
  } else if (d.kind === "normal") {
    lines.push(`The average for ${who} is ${d.mean.toFixed(1)} ${spec.unit ?? ""}, and most fall within ${d.sd.toFixed(1)} ${spec.unit ?? ""} of that.`);
    if (trace.percentile !== undefined) lines.push(`This person is ${spec.id === "body.height_cm" ? "taller" : "higher"} than about ${pct(trace.percentile)} of that group.`);
  } else if (d.kind === "bernoulli") {
    lines.push(`About ${pct(d.p)} of ${who} ${spec.id === "body.left_handed" ? "are left-handed" : spec.id === "health.smoker_daily" ? "smoke daily" : "have this trait"}. This roll came up ${t.value ? "yes" : "no"}.`);
  } else {
    lines.push(`${pct(trace.probability!)} of ${who} fall in this category.`);
  }
  for (const m of trace.modifiers) lines.push(`Adjustment applied: ${m.rationale}`);
  for (const b of trace.backoff_steps) {
    if (b.key === "frame.country") lines.push(`There is no figure for ${placeName(b.from, reg)}, so the average for ${placeName(b.to, reg)} was used instead.`);
    else if (b.key === "frame.birth_cohort") lines.push(`The data ends with people born in the late 1990s, so the most recent group (born ${b.to} to ${Number(b.to) + 4}) was used.`);
    else lines.push(`No exact match for ${b.from}; used ${b.to}.`);
  }
  return lines;
}

function describeCondition(spec: TraitSpec): string {
  const p = spec.applies_when;
  if (p && "trait" in p && p.trait === "frame.age" && p.op === "gte") return `age ${p.value} and over`;
  return "see definition";
}
