// Population test: roll many people and check that the simulated population matches the sourced figures.
import { beforeAll, describe, expect, it } from "vitest";
import { loadRegistry } from "../src/engine/loadNode";
import { roll } from "../src/engine/roll";
import type { Value } from "../src/engine/types";

const reg = loadRegistry();
const N = 300_000;
let people: Record<string, Value>[] = [];

beforeAll(() => {
  people = Array.from({ length: N }, (_, i) => {
    const p = roll(reg, { seed: `pop-${i}` });
    return Object.fromEntries(Object.entries(p.traits).map(([k, v]) => [k, v.value]));
  });
}, 120_000);

const share = (rows: Record<string, Value>[], f: (p: Record<string, Value>) => boolean) => rows.filter(f).length / rows.length;
const row = (id: string, key: string) => reg.traits.get(id)!.baseline!.table[key];

describe(`simulated population of ${N.toLocaleString()} people`, () => {
  it("matches country shares for the ten largest countries (within 5% relative)", () => {
    const spec = reg.traits.get("frame.country")!;
    const top = spec.categories!.map((c, i) => [c, row("frame.country", "")[i]] as const).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [code, expected] of top) {
      const got = share(people, (p) => p["frame.country"] === code);
      expect(Math.abs(got - expected) / expected, reg.geo[code].name).toBeLessThan(0.05);
    }
  });

  it("matches the sex ratio in India and the median-age contrast between Japan and Nigeria", () => {
    const india = people.filter((p) => p["frame.country"] === "356");
    expect(share(india, (p) => p["frame.sex"] === "male")).toBeCloseTo(row("frame.sex", "356")[0], 2);
    const mean = (code: string) => { const r = people.filter((p) => p["frame.country"] === code); return r.reduce((s, p) => s + Number(p["frame.age"]), 0) / r.length; };
    expect(mean("392")).toBeGreaterThan(mean("566") + 20);
  });

  it("matches mean height for a stratum (within 0.1 SD)", () => {
    for (const [code, sex, cohort] of [["356", "male", "1990"], ["156", "female", "1985"]]) {
      const g = people.filter((p) => p["frame.country"] === code && p["frame.sex"] === sex && p["frame.birth_cohort"] === cohort);
      const [mean, sd] = row("body.height_cm", `${code}|${sex}|${cohort}`);
      const got = g.reduce((s, p) => s + Number(p["body.height_cm"]), 0) / g.length;
      expect(g.length).toBeGreaterThan(500);
      expect(Math.abs(got - mean) / sd, `${code} ${sex} ${cohort}`).toBeLessThan(0.1);
    }
  });

  it("keeps left-handedness at the sourced 10.6% overall and 1.23 odds ratio between sexes", () => {
    const overall = share(people, (p) => p["body.left_handed"] === true);
    expect(Math.abs(overall - 0.106)).toBeLessThan(0.003);
    const odds = (sex: string) => { const s = share(people.filter((p) => p["frame.sex"] === sex), (p) => p["body.left_handed"] === true); return s / (1 - s); };
    const or = odds("male") / odds("female");
    expect(or).toBeGreaterThan(1.19);
    expect(or).toBeLessThan(1.27);
  });

  it("matches daily smoking among adult men and women in China (within 1 percentage point)", () => {
    for (const sex of ["male", "female"]) {
      const g = people.filter((p) => p["frame.country"] === "156" && p["frame.sex"] === sex && Number(p["frame.age"]) >= 15);
      expect(Math.abs(share(g, (p) => p["health.smoker_daily"] === true) - row("health.smoker_daily", `156|${sex}`)[0])).toBeLessThan(0.01);
    }
  });

  it("matches education shares for women aged 30 to 34 in India (within 4 standard errors)", () => {
    const g = people.filter((p) => p["frame.country"] === "356" && p["frame.sex"] === "female" && p["frame.age_group"] === "30--34");
    const expected = row("social.education", "356|female|30--34");
    expect(g.length).toBeGreaterThan(1000);
    reg.traits.get("social.education")!.categories!.forEach((c, i) => {
      const se = Math.sqrt((expected[i] * (1 - expected[i])) / g.length);
      expect(Math.abs(share(g, (p) => p["social.education"] === c) - expected[i]), c).toBeLessThan(4 * se + 0.005);
    });
  });

  it("matches the urban share in Brazil (within 1 percentage point)", () => {
    const g = people.filter((p) => p["frame.country"] === "76");
    expect(Math.abs(share(g, (p) => p["origin.setting"] === "urban") - row("origin.setting", "76")[0])).toBeLessThan(0.01);
  });
});
