# Working in this repository

- Read `PROJECT_LOG.md` first and update it before finishing.
- The owner is non-technical: explain in plain language, and keep all user-facing text jargon-free.
- Never add a number to `data/` without a source in `data/sources.json`. Mark anything assumed in the trait's `assumptions` with grade D.
- The engine (`src/engine/`) must stay trait-agnostic. New traits are data files, not code.
- Run `npm test` and `npm run build` before committing.
