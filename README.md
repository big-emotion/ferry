# Ferry

Semi-autonomous delivery pipeline: Jira board → GitHub PR, with humans only deciding *what must be done* and *what is acceptable*.

**Status**: Pre-PRD. Inputs consolidated in [`docs/inputs/`](docs/inputs).

## Inputs

- [`00-source-one-pager.md`](docs/inputs/00-source-one-pager.md) — original one-pager (formerly "Symphony HITL")
- [`01-review-adversarial.md`](docs/inputs/01-review-adversarial.md) — adversarial review
- [`02-review-edge-cases.md`](docs/inputs/02-review-edge-cases.md) — edge-case hunter review
- [`03-decisions-synthesis.md`](docs/inputs/03-decisions-synthesis.md) — user decisions + synthesis, input for PRD

## Next

PRD via BMad `bmad-create-prd` → `docs/prd.md`.
