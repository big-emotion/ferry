# Reviewer-grade rubric

A four-dimension rubric used by humans (and by `scripts/ferry-grade.ts`) to grade the **quality of a review** post-hoc. Each dimension scores **0–2**.

## Dimensions

| Dimension       | 0                                                        | 1                                              | 2                                                  |
| --------------- | -------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| **Substantive** | Did not address the actual change.                       | Partially addressed; some findings off-target. | Engaged with every meaningful piece of the diff.   |
| **Specific**    | No file:line references; vague pointers.                 | Some references, some hand-waving.             | Every finding cites file:line + concrete behavior. |
| **Correct**     | Findings are wrong (false positives or fabricated bugs). | Mostly right with one or two over-reaches.     | Every finding is technically defensible.           |
| **Actionable**  | No fix proposals; just complaints.                       | Some fixes, some hand-waving.                  | Every finding includes a clear, minimal fix.       |

## Verdict thresholds

Total score = sum of the four dimensions (range 0–8).

| Total | Verdict        |
| ----- | -------------- |
| 5–8   | `actionable`   |
| 3–4   | `weak`         |
| 0–2   | `rubber_stamp` |

## The Correct=0 cap

If **Correct = 0**, the verdict is **capped at `weak`** — even when the totals would otherwise yield `actionable`.

> A review with no correct findings can never be actionable. It might _look_ substantive and well-cited, but it's misleading: shipping based on it would introduce regressions or waste iteration time chasing non-bugs.

The cap **does not promote** lower verdicts upward — a `rubber_stamp` total stays `rubber_stamp` even if Correct=0. The cap is one-directional: actionable → weak.

### Examples

| Substantive | Specific | Correct | Actionable | Total | Raw verdict  | Final verdict     |
| ----------- | -------- | ------- | ---------- | ----- | ------------ | ----------------- |
| 2           | 2        | 2       | 2          | 8     | actionable   | actionable        |
| 2           | 1        | 2       | 1          | 6     | actionable   | actionable        |
| 2           | 2        | 0       | 2          | 6     | actionable   | **weak (capped)** |
| 1           | 1        | 1       | 1          | 4     | weak         | weak              |
| 1           | 1        | 0       | 1          | 3     | weak         | weak              |
| 1           | 1        | 0       | 0          | 2     | rubber_stamp | rubber_stamp      |
| 0           | 0        | 0       | 0          | 0     | rubber_stamp | rubber_stamp      |

## Tooling

The interactive CLI prompts for the four scores and emits a single audit line:

```bash
tsx scripts/ferry-grade.ts <pr-number>
```

Pure verdict logic: [`src/lib/grade/index.ts`](../src/lib/grade/index.ts) (function `computeReviewerVerdict`).

## When to grade

- Always after a `Ready to Merge` or `Changes Requested` outcome.
- Always after the final iteration round (round 3 or oscillation halt).
- The graded line is appended to the audit issue with `phase: reviewer_grade`.

Run rates >90% `actionable` mean Reviewer prompts are well-tuned. Runs trending toward `weak` or `rubber_stamp` mean it's time to revisit the `prompt-templates/reviewer.md` prompt.
