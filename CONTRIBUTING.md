# Contributing

RT Test is at the foundation stage. Read the [plan](docs/plan.md), [roadmap](docs/roadmap.md), and [AGENTS.md](AGENTS.md) before a substantial change.

Use Node from the supported release lines in `package.json` and Bun 1.3.14. Install with `bun install --frozen-lockfile`. Work on `dev-work` or a feature branch and run `bun run check` before submitting code changes.

Describe the behavior changed, the named defect covered, and the validation performed. Separate implemented features from proposals. Keep changes focused and avoid adding framework dependencies to the core.

Use synthetic public fixtures. Never include private application code, customer data, credentials, or captured environment values in issues, fixtures, or reports.

The repository is MIT licensed. Package publication is a separate release step; the starter package is intentionally private to prevent accidental npm publication.
