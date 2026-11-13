// Runs every validation gate and writes data/validation_report.json, which the site's accuracy page shows.
// Run with: npm run validate
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry } from "../src/engine/loadNode";
import { runGates } from "../src/validation/gates";

const report = runGates(loadRegistry());
for (const t of report.traits) {
  for (const g of t.gates) if (g.status !== "skip") console.log(`${g.status === "pass" ? "ok  " : "FAIL"} ${t.id.padEnd(22)} ${g.name}: ${g.detail}`);
}
const round = (x: number) => Math.round(x * 100) / 100;
for (const t of report.traits) for (const e of t.examples) { e.expected = round(e.expected); e.simulated = round(e.simulated); }
writeFileSync(join(process.cwd(), "data", "validation_report.json"), JSON.stringify(report, null, 1));
console.log(`\n${report.summary.passed} of ${report.summary.traits} traits pass (${report.people.toLocaleString("en")} simulated people).`);
if (report.summary.failed) process.exit(1);
