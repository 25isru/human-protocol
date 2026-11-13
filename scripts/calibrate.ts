// Solves calibration offsets for traits with modifiers and writes them into the trait files.
// Run with: npm run calibrate
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { solveCategoricalOffsets, solveOffset } from "../src/engine/calibrate";
import { loadRegistry } from "../src/engine/loadNode";

const reg = loadRegistry();
for (const spec of reg.traits.values()) {
  if (!spec.modifiers.length || !spec.baseline) continue;
  if (spec.baseline.dist_kind === "categorical") {
    const offsets = solveCategoricalOffsets(reg, spec.id);
    const file = join(process.cwd(), "data", "traits", `${spec.id}.json`);
    const json = JSON.parse(readFileSync(file, "utf8"));
    json.baseline.calibration = offsets;
    writeFileSync(file, JSON.stringify(json, null, 4));
    console.log(`${spec.id}: solved offsets for ${Object.keys(offsets).length} rows`);
    continue;
  }
  if (spec.baseline.dist_kind !== "bernoulli") continue;
  const { offset, target, before } = solveOffset(reg, spec.id);
  const file = join(process.cwd(), "data", "traits", `${spec.id}.json`);
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.calibration_offset = offset;
  writeFileSync(file, JSON.stringify(json, null, 4));
  console.log(`${spec.id}: target ${(target * 100).toFixed(2)}%, uncalibrated ${(before * 100).toFixed(2)}%, offset ${offset}`);
}
