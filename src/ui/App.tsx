import { useCallback, useEffect, useMemo, useState } from "react";
import { roll } from "../engine/roll";
import { randomSeed } from "../engine/rng";
import type { Profile, RolledTrait, TraitSpec, Value } from "../engine/types";
import { registry } from "../registry";
import { Accuracy } from "./Accuracy";
import { GRADE_LABEL, explain, flag, formatValue, placeName } from "./explain";

interface Pins { country: string; sex: string; age: string }
const NO_PINS: Pins = { country: "", sex: "", age: "" };

function toRequestPins(p: Pins): Record<string, Value> {
  const out: Record<string, Value> = {};
  if (p.country) out["frame.country"] = p.country;
  if (p.sex) out["frame.sex"] = p.sex;
  if (p.age !== "" && !Number.isNaN(Number(p.age))) out["frame.age"] = Math.max(0, Math.min(100, Math.round(Number(p.age))));
  return out;
}

function readHash(): { seed?: string; pins: Pins } {
  const q = new URLSearchParams(window.location.hash.slice(1));
  return { seed: q.get("seed") ?? undefined, pins: { country: q.get("country") ?? "", sex: q.get("sex") ?? "", age: q.get("age") ?? "" } };
}

function writeHash(seed: string, pins: Pins) {
  const q = new URLSearchParams({ seed });
  for (const [k, v] of Object.entries(pins)) if (v) q.set(k, v);
  try { window.history.replaceState(null, "", `#${q}`); } catch { /* sandboxed preview */ }
}

function headline(p: Profile): { title: string; sub: string; emoji: string } {
  const v = (id: string) => p.traits[id]?.value;
  const age = Number(v("frame.age"));
  const male = v("frame.sex") === "male";
  const noun = age < 18 ? (male ? "boy" : "girl") : male ? "man" : "woman";
  const ageText = age === 0 ? "A baby" : age >= 100 ? "A centenarian" : `A${[8, 11, 18].includes(age) || (age >= 80 && age < 90) ? "n" : ""} ${age}-year-old`;
  const code = String(v("frame.country"));
  const title = age === 0 ? `A baby ${male ? "boy" : "girl"} in ${withArticle(placeName(code, registry))}` : `${ageText} ${noun} in ${withArticle(placeName(code, registry))}`;
  const setting = v("origin.setting") === "urban" ? "lives in a town or city" : v("origin.setting") === "rural" ? "lives in the countryside" : "";
  const sub = [`Born ${v("frame.birth_year")}`, String(v("geo.subregion") ?? ""), setting].filter(Boolean).join(" · ");
  return { title, sub, emoji: flag(registry.geo[code]?.iso2) };
}

function withArticle(name: string): string {
  return /^(United|Russian|Democratic|Dominican|Central African|Syrian|Republic|State of|Bahamas|Gambia|Netherlands|Philippines|Maldives|Comoros|Seychelles|Solomon|Marshall|Cayman|Falkland|Faroe|Cook|Turks|Northern Mariana|British Virgin|Isle of Man)/.test(name) ? `the ${name}` : name;
}

function Bars({ t, spec }: { t: RolledTrait; spec: TraitSpec }) {
  const d = t.trace.dist;
  if (!d || d.kind !== "categorical" || d.categories.length > 8) return null;
  const max = Math.max(...d.p);
  return (
    <div className="bars" role="img" aria-label="Share of this group in each category">
      {d.categories.map((c, i) => (
        <div key={c} className={`bar-row${String(t.value) === c ? " is-rolled" : ""}`}>
          <span className="bar-label">{spec.category_labels?.[c] ?? c}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(d.p[i] / max) * 100}%` }} /></span>
          <span className="bar-num">{(d.p[i] * 100).toFixed(d.p[i] < 0.1 ? 1 : 0)}%</span>
        </div>
      ))}
    </div>
  );
}

function TraitRow({ spec, t, profile }: { spec: TraitSpec; t: RolledTrait; profile: Profile }) {
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => explain(spec, t, registry, profile), [spec, t, profile]);
  const muted = !t.trace.applicable || t.value === null;
  return (
    <li className={`trait${open ? " is-open" : ""}`}>
      <button className="trait-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="trait-label">{spec.label}</span>
        <span className={`trait-value${muted ? " is-muted" : ""}`}>{formatValue(spec, t, registry)}</span>
        <span className="chev" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="trait-body">
          {lines.map((l, i) => <p key={i}>{l}</p>)}
          <Bars t={t} spec={spec} />
          {!t.trace.derived && t.trace.applicable && (
            <>
              <p className="meta">
                <span className={`grade grade-${t.trace.grade}`}>{GRADE_LABEL[t.trace.grade]}</span>
                {spec.ref_year && <span> · data for {spec.ref_year}</span>}
                {spec.low_confidence && <span> · treat with caution</span>}
              </p>
              {spec.assumptions?.map((a, i) => <p key={i} className="note"><strong>Assumption:</strong> {a.what}. {a.why}</p>)}
              {spec.notes.map((n, i) => <p key={i} className="note">{n}</p>)}
              <ul className="sources">
                {t.trace.source_ids.map((id) => {
                  const s = registry.sources[id];
                  return <li key={id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> — {s.publisher}</li>;
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function App() {
  const initial = useMemo(readHash, []);
  const [pins, setPins] = useState<Pins>(initial.pins);
  const [seed, setSeed] = useState(initial.seed ?? randomSeed());
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"roll" | "accuracy">(window.location.hash === "#accuracy" ? "accuracy" : "roll");

  const result = useMemo(() => {
    try { return { profile: roll(registry, { seed, pins: toRequestPins(pins) }) }; }
    catch (e) { return { error: (e as Error).message }; }
  }, [seed, pins]);

  useEffect(() => {
    if (view === "roll") writeHash(seed, pins);
    else try { window.history.replaceState(null, "", "#accuracy"); } catch { /* sandboxed preview */ }
  }, [seed, pins, view]);
  const reroll = useCallback(() => setSeed(randomSeed()), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === " " && view === "roll" && tag !== "INPUT" && tag !== "SELECT" && tag !== "BUTTON") { e.preventDefault(); reroll(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reroll, view]);

  const countries = useMemo(() => Object.entries(registry.geo).sort((a, b) => a[1].name.localeCompare(b[1].name)), []);
  const visible = registry.order.map((id) => registry.traits.get(id)!).filter((s) => !s.hidden);
  const profile = result.profile;
  const head = profile ? headline(profile) : null;
  const pinned = Boolean(pins.country || pins.sex || pins.age);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  return (
    <main>
      <header className="top">
        <h1>Human Protocol</h1>
        <p>Roll a random living person, drawn from real population statistics.</p>
        <nav className="tabs">
          <button className={view === "roll" ? "is-active" : ""} onClick={() => setView("roll")}>Roll</button>
          <button className={view === "accuracy" ? "is-active" : ""} onClick={() => setView("accuracy")}>Accuracy</button>
        </nav>
      </header>

      {view === "accuracy" && <Accuracy />}
      {view === "roll" && (<>

      <section className="controls">
        <button className="roll" onClick={reroll}>Roll a human</button>
        <details className="pins" open={pinned}>
          <summary>Fix some details{pinned ? " (active)" : ""}</summary>
          <div className="pin-grid">
            <label>Country
              <select value={pins.country} onChange={(e) => setPins({ ...pins, country: e.target.value })}>
                <option value="">Any</option>
                {countries.map(([code, g]) => <option key={code} value={code}>{g.name}</option>)}
              </select>
            </label>
            <label>Sex
              <select value={pins.sex} onChange={(e) => setPins({ ...pins, sex: e.target.value })}>
                <option value="">Any</option><option value="female">Female</option><option value="male">Male</option>
              </select>
            </label>
            <label>Age
              <input type="number" min={0} max={100} placeholder="Any" value={pins.age} onChange={(e) => setPins({ ...pins, age: e.target.value })} />
            </label>
            {pinned && <button className="link" onClick={() => setPins(NO_PINS)}>Clear</button>}
          </div>
        </details>
      </section>

      {result.error && <p className="error">{result.error}</p>}

      {profile && head && (
        <article className="card" key={profile.seed}>
          <div className="card-head">
            <span className="flag" aria-hidden="true">{head.emoji}</span>
            <div>
              <h2>{head.title}</h2>
              <p>{head.sub}</p>
            </div>
          </div>
          <ul className="traits">
            {visible.map((spec) => <TraitRow key={spec.id} spec={spec} t={profile.traits[spec.id]} profile={profile} />)}
          </ul>
          <footer className="card-foot">
            <span>Seed <code>{profile.seed}</code></span>
            <button className="link" onClick={copyLink}>{copied ? "Copied" : "Copy link to this person"}</button>
          </footer>
        </article>
      )}

      </>)}

      <footer className="about">
        <p>Each value is rolled from figures for people like this one: the same country, sex and age where the data allows. Open any row to see the numbers and where they come from.</p>
        <p>This person is fictional. {visible.length} traits so far, version {registry.version}.</p>
      </footer>
    </main>
  );
}
