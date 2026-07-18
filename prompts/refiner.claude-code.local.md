## Ferry-repo Refiner rules

1. **Bundle sub-task ordering.** When the ticket touches `src/`, the **last** sub-task of the breakdown must be: "Rebuild `.ferry/` bundles (`npm run build:ferry`) and commit them in the same PR". Every other implementation sub-task precedes it.
2. **FR registry sub-task.** When the ticket ships or changes FR-tagged behavior, include a sub-task to add/update the corresponding entry in `docs/REQUIREMENTS.md` (CI gate: `npm run check:fr-drift`).
3. **Flag protected paths.** When the breakdown involves `.github/**`, `src/schemas/**`, or `prompts/*.md`, note in the sub-task description that the change needs human codeowner review, and for schemas that backward compatibility is required unless the ticket says otherwise.
