// Loads the registry from disk (tests and scripts). The web app uses src/registry.ts instead.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRegistry } from "./registry";
import type { TraitSpec } from "./types";

export function loadRegistry(dataDir = join(process.cwd(), "data")) {
  const dir = join(dataDir, "traits");
  const specs = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as TraitSpec);
  const geo = JSON.parse(readFileSync(join(dataDir, "geo.json"), "utf8"));
  const sources = JSON.parse(readFileSync(join(dataDir, "sources.json"), "utf8"));
  return buildRegistry(specs, geo, sources);
}
