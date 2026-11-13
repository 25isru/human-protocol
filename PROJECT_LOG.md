# Project log

This file is the project's memory. Read it first; update it at the end of every working session.

## Goal

A web app that rolls a statistically realistic random human, growing towards the full design in the
protocol document: AI-researched traits, validation gates, correlated traits, genetics, families.
The owner is not a statistician or developer, so automated checks must stand in for human review, and
everything shown to users must be in plain language with sources.

## Roadmap

1. **Core roller** — done (2026-11-13).
2. **Validation harness** — done (2026-11-13). `src/validation/gates.ts` runs five gates per trait (well-formed data, sources, adjustment bounds, simulated-vs-source, adjustment effect). `npm run validate` writes `data/validation_report.json`, shown on the site's Accuracy tab. Tests prove each gate catches a deliberately broken trait, and fail if the committed report is stale.
3. **Research agent** — script that researches a trait, extracts cited numbers, runs the gates, opens a pull request. Needs an LLM API key.
4. **Depth** — copula blocks for correlated traits, pins on any trait (done generically via likelihood weighting; UI exposes three), counterfactual rolls.
5. **Genetics and families.**
6. **Full backend** — database, on-demand research, saved profiles, API.

## Decisions

- TypeScript everywhere; engine runs in the browser; trait data is JSON in this repo; static hosting.
- Conditional tables are stored as compact keyed rows (`"country|sex|cohort": [numbers]`), not one object per stratum as in the protocol document. Same meaning, far smaller files.
- Geographic fallback rows (`S:<subregion>`, `R:<region>`, `W`) are precomputed in `build_data.py`.
- Country, sex and age are factored as country → sex | country → age | country, sex, so they use the ordinary engine.
- No ancestry or genotype links into personality, cognition, values or social position (confirmed by the owner).
- Only data that could be traced to a citable source was included. Fewer traits, properly sourced, over many loose ones.

## Known gaps and honest caveats

- **Height spread is assumed** (SD 7.0 cm men, 6.5 cm women). The source gives means only. Find a sourced SD by country.
- **Height cohorts end at 1996**; younger adults use the 1995 cohort.
- **Smoking data is from 2012** and has no age gradient: a 15-year-old gets the national adult rate. Replace with WHO or newer IHME data by age.
- **Urban/rural** is not conditioned on age or sex, and education is not conditioned on urban/rural.
- **Left-handedness** uses one worldwide rate; regional variation is documented in the source but not modelled.
- 36 small territories have no education data and use subregion averages. Holy See is excluded (no age data).
- Sex is binary because the population statistics are.
- Calibration offsets and the adjustment-effect gate are only implemented for yes/no traits.
- The gates check that the simulation reproduces its sources. They do not yet check a number against the text of its source document; that arrives with the research agent.

## Raw data

`scripts/build_data.py <dir>` expects shallow clones of `PPgp/wpp2024`, `owid/owid-datasets` and
`guyabel/wcde-data` in `<dir>`. Needs Python with pandas, pyreadr and pycountry.
After rebuilding, run `npm run calibrate` and `npm test`.

## Next steps

1. Stage 3: the research agent. Needs an LLM API key from the owner. It should output a trait file plus sources, then run `runGates` on the result; the gates not yet written are the ones that need source documents (quote matching, dual extraction).
2. Fix the known gaps above with better sources (height spread, smoking by age and newer year).
3. More sourced traits: BMI (NCD-RisC, needs a spread), marital status (UN World Marriage Data), number of children (WPP fertility), religion (Pew), languages, occupation sector (ILO), literacy.
4. Counterfactual button ("same person, born elsewhere"): reuse each trait's stored `u`.

## Workflow after changing any trait data

`npm run calibrate` → `npm run validate` → `npm test` → `npm run build`. Commit the updated `data/validation_report.json`.
