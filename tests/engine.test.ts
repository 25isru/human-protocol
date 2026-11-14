import { describe, expect, it } from "vitest";
import { inverseCdf, normCdf, normInv } from "../src/engine/dist";
import { loadRegistry } from "../src/engine/loadNode";
import { buildRegistry } from "../src/engine/registry";
import { lookup, roll } from "../src/engine/roll";

const reg = loadRegistry();
const values = (seed: string, pins = {}) => Object.fromEntries(Object.entries(roll(reg, { seed, pins }).traits).map(([k, v]) => [k, v.value]));

describe("distributions", () => {
  it("inverts the normal CDF", () => {
    for (const p of [0.001, 0.025, 0.2, 0.5, 0.8, 0.975, 0.999]) expect(normCdf(normInv(p))).toBeCloseTo(p, 5);
    expect(normInv(0.975)).toBeCloseTo(1.96, 2);
  });
  it("samples categories by cumulative probability", () => {
    const d = { kind: "categorical" as const, categories: ["a", "b", "c"], p: [0.2, 0.5, 0.3] };
    expect(inverseCdf(d, 0.1)).toBe("a");
    expect(inverseCdf(d, 0.69)).toBe("b");
    expect(inverseCdf(d, 0.71)).toBe("c");
  });
});

describe("registry", () => {
  it("orders every trait after its parents", () => {
    for (const id of reg.order) for (const p of reg.traits.get(id)!.parents) expect(reg.order.indexOf(p)).toBeLessThan(reg.order.indexOf(id));
  });
  it("rejects a dependency cycle", () => {
    const specs = [...reg.traits.values()].map((s) => (s.id === "frame.country" ? { ...s, parents: ["frame.age"] } : s));
    expect(() => buildRegistry(specs, reg.geo, reg.sources)).toThrow(/cycle/i);
  });
  it("every probability row sums to 1", () => {
    for (const s of reg.traits.values()) {
      if (s.baseline?.dist_kind !== "categorical") continue;
      for (const [k, row] of Object.entries(s.baseline.table)) expect(Math.abs(row.reduce((a, b) => a + b, 0) - 1), `${s.id} ${k}`).toBeLessThan(0.01);
    }
  });
});

describe("rolling", () => {
  it("is reproducible from the seed", () => {
    expect(values("abc")).toEqual(values("abc"));
    expect(values("abc")).not.toEqual(values("abd"));
  });
  it("keeps existing traits unchanged when a trait is removed from the registry", () => {
    const smaller = buildRegistry([...reg.traits.values()].filter((s) => s.id !== "body.left_handed"), reg.geo, reg.sources);
    const a = values("stable");
    const b = Object.fromEntries(Object.entries(roll(smaller, { seed: "stable" }).traits).map(([k, v]) => [k, v.value]));
    for (const k of Object.keys(b)) expect(a[k]).toEqual(b[k]);
  });
  it("skips traits that do not apply", () => {
    const p = roll(reg, { seed: "kid", pins: { "frame.age": 7 } });
    expect(p.traits["body.height_cm"].value).toBeNull();
    expect(p.traits["body.height_cm"].trace.applicable).toBe(false);
    expect(p.traits["social.education"].value).toBeNull();
  });
  it("respects pinned values", () => {
    const v = values("pin", { "frame.country": "752", "frame.sex": "female", "frame.age": 40 });
    expect(v["frame.country"]).toBe("752");
    expect(v["frame.sex"]).toBe("female");
    expect(v["frame.age"]).toBe(40);
    expect(v["frame.birth_year"]).toBe(1986);
  });
  it("falls back to the subregion when a country has no data, and lowers the grade", () => {
    const p = roll(reg, { seed: "mc", pins: { "frame.country": "492", "frame.age": 40 } }); // Monaco
    const t = p.traits["social.education"].trace;
    expect(t.backoff_steps[0]).toMatchObject({ key: "frame.country", from: "492", to: "S:Western Europe" });
    expect(t.grade).toBe("B");
  });
  it("uses the nearest birth cohort for young adults", () => {
    const p = roll(reg, { seed: "young", pins: { "frame.country": "356", "frame.age": 20 } });
    expect(p.traits["body.height_cm"].trace.backoff_steps).toContainEqual(expect.objectContaining({ key: "frame.birth_cohort", to: "2000" }));
  });
  it("finds rows with combined backoff", () => {
    const spec = reg.traits.get("body.height_cm")!;
    const found = lookup(spec.baseline!, { "frame.country": "492", "frame.sex": "male", "frame.birth_cohort": "2005", "origin.setting": "urban" }, reg);
    expect(found?.steps.map((x) => x.key).sort()).toEqual(["frame.birth_cohort", "frame.country", "origin.setting"]);
  });
  it("uses the national figure for cohorts with no urban or rural split, without shifting the cohort", () => {
    const spec = reg.traits.get("body.height_cm")!;
    const found = lookup(spec.baseline!, { "frame.country": "356", "frame.sex": "male", "frame.birth_cohort": "1950", "origin.setting": "urban" }, reg);
    expect(found?.stratum).toMatchObject({ "frame.birth_cohort": "1950", "origin.setting": "*" });
  });
});
