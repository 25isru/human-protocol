// Bundles every trait file in data/traits into the web app.
import geo from "../data/geo.json";
import sources from "../data/sources.json";
import { buildRegistry } from "./engine/registry";
import type { GeoEntry, Source, TraitSpec } from "./engine/types";

const modules = import.meta.glob("../data/traits/*.json", { eager: true, import: "default" });
export const registry = buildRegistry(
  Object.values(modules) as TraitSpec[],
  geo as Record<string, GeoEntry>,
  sources as unknown as Record<string, Source>,
);
