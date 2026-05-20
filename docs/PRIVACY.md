# Ferry — Privacy

> ⚠️ **Read before first use.**

Ferry transmits the following data to your configured LLM provider(s) (Anthropic by default):

- Jira ticket titles, descriptions, comments, and sub-tasks
- File contents and diffs from the target GitHub repository
- Code review feedback and re-prompts

No customer data is stored by Ferry itself, but Anthropic's data-retention policy applies. Review their terms and obtain organisational approval before pointing Ferry at any repo containing confidential code or PII.

## LLM providers

Ferry supports **Anthropic** (default), **OpenAI**, and **Google AI**. Each provider has its own data retention and privacy policies:

- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- [Google AI Privacy Policy](https://policies.google.com/privacy)

See the [provider × phase matrix](CONFIGURATION.md#provider--phase-matrix) for a full breakdown of which provider is used in each agent phase.
