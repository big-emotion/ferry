# What is Ferry?

Ferry is a **GitHub Actions pipeline for Jira-driven development**. It runs AI agents that take your Jira ticket and automatically:

1. Break it into sub-tasks
2. Write code
3. Open a draft PR
4. Review the code
5. Apply feedback (in iteration loops)

You always stay in control — Ferry never merges anything. You review the draft PR and merge when it's ready.

## How It Works

```
You move a Jira ticket column
        ↓
GitHub receives webhook
        ↓
Ferry workflow triggers
        ↓
┌─────────────────────┐
│ Refiner agent       │  Reads ticket → posts sub-task breakdown
├─────────────────────┤
│ Developer agent     │  Writes code → opens draft PR
├─────────────────────┤
│ Reviewer agent      │  Reviews code → posts feedback
├─────────────────────┤
│ Iterator agent      │  Applies feedback → re-reviews (max 3 rounds)
└─────────────────────┘
        ↓
Draft PR ready for you to review and merge
```

## What Ferry Is NOT

- **Not a replacement for human review** — you always merge
- **Not for general AI coding** — only runs on explicit Jira triggers
- **Not vendor-locked** — use Claude (Anthropic), Gemini (Google AI), or GPT-4 (OpenAI)

## Agents at a Glance

| Agent | Runs when | Does what |
|-------|-----------|-----------|
| **Refiner** | Ticket moved to "Refinement" | Reads ticket, posts sub-task breakdown, waits for approval |
| **Developer** | Ticket moved to "In Development" | Reads approved sub-tasks, writes code, opens draft PR |
| **Reviewer** | PR is ready (CI passes) | Reads PR diff, posts code review comments |
| **Iterator** | Feedback received | Applies changes, re-triggers Reviewer (max 3 rounds) |

## Privacy

Ferry sends the following to LLM providers (Anthropic, Google AI, OpenAI):
- Jira ticket content (title, description, comments)
- GitHub code and diffs from your repo
- Code review feedback

Ferry itself doesn't store data — your LLM provider's data policy applies. Review their terms before using on confidential code.

---

**Want to use Ferry in your project?** See [CONSUMER-SETUP.md](CONSUMER-SETUP.md) for a step-by-step guide.
