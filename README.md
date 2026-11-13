# Human Protocol

Roll a random living person, drawn from real population statistics.

Each trait is rolled from figures for people like the one being rolled: the same country, sex and age
where the data allows. Every value on the card can be opened to see the numbers used, how strong the
evidence is, and the source.

## Run it

```
npm install
npm run dev        # open the local address it prints
npm test           # engine tests and the population accuracy test
npm run build      # production site in dist/
```

Pushing to `main` runs the tests and publishes the site with GitHub Pages
(enable once under Settings → Pages → Source: GitHub Actions).

## How it works

- `data/traits/*.json`: one file per trait: definition, what it depends on, the table of figures, sources, caveats.
- `data/sources.json`: every source cited by a trait.
- `src/engine/`: the rolling engine. It has no knowledge of specific traits; it reads the trait files.
- `src/ui/`: the web page.
- `scripts/build_data.py`: rebuilds the trait files from the raw datasets.
- `scripts/calibrate.ts`: solves calibration offsets for traits with modifiers.
- `tests/population.test.ts`: rolls 300,000 people and checks the simulated population against the sources.

Traits are rolled in dependency order (country → sex → age → everything else). A trait looks up the row
matching the person so far. If a country has no figure, it falls back to the subregion, then the region,
then the world, and the evidence grade shown on the card drops one step each time.

The same seed always produces the same person. Adding a new trait never changes existing traits for an old seed.

## Traits so far

| Trait | Depends on | Source | Evidence |
| --- | --- | --- | --- |
| Country of residence | — | UN World Population Prospects 2024 | A |
| Sex | country | UN WPP 2024 | A |
| Age | country, sex | UN WPP 2024 | A |
| Birth year, region, subregion | derived | UN WPP 2024 | A |
| Urban or rural | country | UN World Urbanization Prospects 2018 | A |
| Height (adults) | country, sex, birth cohort | NCD-RisC 2016 (means); spread is an assumption | A / D |
| Education (15+) | country, sex, age group | Wittgenstein Centre v3 | A |
| Left-handed | sex | Papadatou-Pastou et al. 2020 and 2008 | A |
| Smokes daily (15+) | country, sex | IHME 2012 | B, dated |

See `PROJECT_LOG.md` for decisions, known gaps and the roadmap.
