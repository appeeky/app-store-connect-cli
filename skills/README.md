# Agent skills

Install these skills so coding agents follow the right `appstore` / `appstore-mcp` workflows.

Full guide: [docs/skills/overview.mdx](../docs/skills/overview.mdx).

## Install

```bash
# Recommended
appstore install-skills

# Or with the Skills CLI from this repo
npx skills add ./skills --skill '*' -g -y

# Specific agents
appstore install-skills --agent cursor codex
```

Each skill is a folder with a `SKILL.md`; copying folders by hand works too.

## Skills

| Skill | Use for |
|-------|---------|
| [`appstore-cli`](./appstore-cli/SKILL.md) | General CLI usage; start here |
| [`appstore-auth`](./appstore-auth/SKILL.md) | API keys, env vars, Individual keys, read-only |
| [`appstore-accounts`](./appstore-accounts/SKILL.md) | Several keys and default apps |
| [`appstore-mcp`](./appstore-mcp/SKILL.md) | Local and hosted MCP |
| [`appstore-ops`](./appstore-ops/SKILL.md) | Registry, `ops call`, every endpoint via `api list/describe/call`, raw requests |
| [`appstore-release`](./appstore-release/SKILL.md) | Versions, metadata, submit, release |
| [`appstore-testflight`](./appstore-testflight/SKILL.md) | Builds, groups, testers, beta review |
| [`appstore-reviews`](./appstore-reviews/SKILL.md) | Review summary and responses |
| [`appstore-media`](./appstore-media/SKILL.md) | Screenshots and previews |
| [`appstore-monetization`](./appstore-monetization/SKILL.md) | In-app purchases and subscriptions |
| [`appstore-signing`](./appstore-signing/SKILL.md) | Bundle IDs, devices, certificates, profiles |
| [`appstore-users`](./appstore-users/SKILL.md) | Team members and invitations |
| [`appstore-reports`](./appstore-reports/SKILL.md) | Sales, finance and analytics reports |
| [`appstore-troubleshooting`](./appstore-troubleshooting/SKILL.md) | Errors and fixes |

## Conventions for agents

1. Run `appstore whoami` (or `appstore_whoami`) when auth is unclear.
2. Ask before any write; then pass `--confirm`.
3. Prefer `--read-only` when the user only asked to look.
4. Load the domain skill for the task; fall back to `appstore-ops` for anything else.
