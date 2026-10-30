# Realm development

- Start from the current `origin/main`; preserve unrelated work. Use a scoped `codex/` branch for changes.
- Read the latest entry and open decisions in `REALM_PROGRESS.md`. Check open pull requests before implementing backlog items.
- Treat historical handover notes as context, not authorization to delete branches, change production, or merge another agent's work.
- Follow the configured roles in the parent workspace's `.codex/agents/` and the `astra-orchestrator` skill when available. Keep implementation ownership explicit.
- Validate relevant behavior using the scripts in `package.json` and `worker/package.json`. Report exact results and skipped checks; historical green runs are not current verification.
- Keep new visitor UI strings in the existing German/English translation system.
- Record each completed change, checks, limitations, and the next concrete step in `REALM_PROGRESS.md`.
- Staging instructions are in `docs/STAGING.md`. Use the explicit `staging` environment; do not deploy the placeholder default configuration.
- Keep tokens and `.dev.vars` files out of Git. Staging contains test data; production and legal/product decisions remain separate.
