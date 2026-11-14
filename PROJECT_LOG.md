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
- Trait files and `geo.json` are written pretty-printed with 4-space indents (the owner's preference, for easier inspection). Keep that format.
- Geographic fallback rows (`S:<subregion>`, `R:<region>`, `W`) are precomputed in `build_data.py`.
- Country, sex and age are factored as country → sex | country → age | country, sex, so they use the ordinary engine.
- No ancestry or genotype links into personality, cognition, values or social position (confirmed by the owner).
- Only data that could be traced to a citable source was included. Fewer traits, properly sourced, over many loose ones.

## Session 2026-11-14

- Owner uploaded the IHME GBD 2019 smoking files and three NCD-RisC height files. No reminders are outstanding.
- **Smoking** replaced: `health.smoker_daily` (2012) is gone; `health.smoker` uses GBD 2019 current smoking, 204 countries, by sex. The published GBD file only has "15+ years", age-standardised, so there is still no age gradient. Age-specific rates need the GBD Results Tool or national surveys.
- **Height** version 2: people born 1970 to 2000 now use NCD-RisC 2020 mean height at age 19; people born earlier keep the 2016 adult series. Height also depends on urban or rural residence for people born 1970 to 2000, using the urban-rural gap from NCD-RisC 2023. This is the first trait conditioned on another rolled personal trait.
- Engine: new backoff `via: "drop"` (falls back to the row keyed `*`); such a step does not lower the evidence grade.
- Unused uploads: GBD cigarettes per capita, number of smokers, percent change; NCD-RisC global and regional files. Cigarettes per capita could later give "cigarettes per day" for smokers.
- GitHub Pages: the owner must set Settings, Pages, Source to "GitHub Actions". Until then the site is blank and the deploy job fails.

## Session 2026-11-13 (third and fourth)

- Profile card reworked: a one-sentence summary of every trait under the headline, and a compact grid of tiles instead of a long list. Summary wording lives in each trait file (`phrases`).
- Added `social.religion` from the Pew 2020 dataset (owner upload; 200 countries, grade A, tagged sensitive). The raw Pew files are not in the repository because they need a Pew account; `build_data.py` expects them unzipped under `<dir>/pew/`.
- `identity.sexual_orientation` is now version 2: per-country figures for 30 countries from the Ipsos 2023 chart (owner uploaded the PDF; values read from the page and cross-checked against the chart objects in the PDF), with adjustments for sex and generation. Other countries use the 30-country average. Grade C, tagged sensitive, three assumptions listed on the card.
- Engine additions to support that: `category_shift` adjustments (several categories at once), a `bins` derivation (used for `frame.generation`), per-row calibration offsets for categorical traits (`baseline.calibration`, solved by `npm run calibrate`), and `no_ci_reason` for adjustments whose source gives no confidence interval.
- No dataset of height spread by country was found. The assumption stays until one is.

## Known gaps and honest caveats

- **Height spread is assumed** (SD 7.0 cm men, 6.5 cm women). The source gives means only. Find a sourced SD by country.
- **Height cohorts end at 2000**; adults born later use the 2000 figures. The two height series differ by about 1 cm in many countries, so there is a small step between people born before and after 1970.
- **Smoking has no age gradient**: a 15-year-old gets the national adult rate.
- **Urban/rural** is not conditioned on age or sex, and education is not conditioned on urban/rural. Traits are still mostly independent of each other once country, sex and age are fixed (no link between education and smoking, religion and anything, and so on). This is the biggest realism gap.
- **Left-handedness** uses one worldwide rate; regional variation is documented in the source but not modelled.
- 36 small territories have no education data and use subregion averages. Holy See is excluded (no age data).
- Sex is binary because the population statistics are.
- The adjustment-effect gate is only implemented for yes/no traits; categorical adjustments are covered by tests in `tests/population.test.ts` instead.
- Sexual orientation outside the 30 surveyed countries is a placeholder (the survey average), and the sex and generation effects are assumed to be the same everywhere.
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
