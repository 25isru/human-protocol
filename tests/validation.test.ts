import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRegistry } from "../src/engine/loadNode";
import { buildRegistry } from "../src/engine/registry";
import type { TraitSpec } from "../src/engine/types";
import { runGates } from "../src/validation/gates";

const reg = loadRegistry();
const withChange = (id: string, change: (s: TraitSpec) => TraitSpec) =>
  buildRegistry([...reg.traits.values()].map((s) => (s.id === id ? change(structuredClone(s)) : s)), reg.geo, reg.sources);
const statusOf = (r: ReturnType<typeof runGates>, trait: string, gate: string) => r.traits.find((t) => t.id === trait)!.gates.find((g) => g.id === gate)!.status;

describe("validation gates", () => {
  it("pass for every trait in the registry", () => {
    const r = runGates(reg, 120_000);
    const failures = r.traits.flatMap((t) => t.gates.filter((g) => g.status === "fail").map((g) => `${t.id} / ${g.name}: ${g.detail}`));
    expect(failures).toEqual([]);
  }, 120_000);

  it("the committed accuracy report matches the current trait data and has no failures", () => {
    const report = JSON.parse(readFileSync("data/validation_report.json", "utf8"));
    expect(report.registry_version, "run `npm run validate`").toBe(reg.version);
    expect(report.summary.failed).toBe(0);
  });

  it("catch a table whose probabilities do not sum to 1", () => {
    const bad = withChange("origin.setting", (s) => { s.baseline!.table["356"] = [0.9, 0.4]; return s; });
    expect(statusOf(runGates(bad, 2000), "origin.setting", "schema")).toBe("fail");
  });

  it("catch a trait with no source", () => {
    const bad = withChange("health.smoker", (s) => ({ ...s, source_ids: [] }));
    expect(statusOf(runGates(bad, 2000), "health.smoker", "citation")).toBe("fail");
  });

  it("catch an adjustment that shifts the population rate away from the source", () => {
    const bad = withChange("body.left_handed", (s) => ({ ...s, calibration_offset: 0.4 }));
    expect(statusOf(runGates(bad, 60_000), "body.left_handed", "marginal")).toBe("fail");
  }, 60_000);

  it("catch an adjustment that does not reproduce its sourced effect", () => {
    const bad = withChange("body.left_handed", (s) => { (s.modifiers[0].effect as { beta: number }).beta = 0.8; return s; });
    expect(statusOf(runGates(bad, 60_000), "body.left_handed", "conditional")).toBe("fail");
  }, 60_000);

  it("catch an implausibly large adjustment backed by weak evidence", () => {
    const bad = withChange("body.left_handed", (s) => { s.modifiers[0].grade = "C"; (s.modifiers[0].effect as { beta: number }).beta = 3.5; return s; });
    expect(statusOf(runGates(bad, 2000), "body.left_handed", "effects")).toBe("fail");
  });
});
