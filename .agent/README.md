# G-VAMS Autonomous Evolution Agent

Version 1 creates the persistent infrastructure for a future daily autonomous engineering loop. It does not change G-VAMS application behavior.

## Architecture

The `.agent/` directory stores the durable state used by future autonomous runs:

- `PROJECT_VISION.md` defines the GNDEC Virtual Academic Mentor System product direction.
- `AUTONOMOUS_RULES.md` is the engineering constitution and safety policy.
- `DEVELOPMENT_MEMORY.md` records long-term cycle observations, outcomes, validation, limitations, and next-direction advice.
- `BACKLOG.md` stores prioritized, evidence-based engineering opportunities.
- `DAILY_DECISIONS.json` stores machine-readable decision history.
- `generated/` is produced by `scripts/autonomous-agent-context.js` and is safe to regenerate.

## Daily autonomous loop

The intended lifecycle is:

1. Inspect the repository.
2. Read Project Health from `docs/PROJECT_HEALTH.md` when available.
3. Read project vision, autonomous rules, development memory, backlog, and previous decisions.
4. Select exactly one focused improvement.
5. Create or use an isolated autonomous branch.
6. Implement the improvement.
7. Run relevant validation.
8. Update memory and decision records.
9. Create a pull request.
10. Let CI and human review decide whether the PR is safe.

## Persistent memory

`DEVELOPMENT_MEMORY.md` is append-only operational memory for human-readable cycle summaries. `DAILY_DECISIONS.json` is the companion machine-readable history. A future runtime must update both after every attempted cycle, including failed validation.

## Backlog prioritization

Backlog entries use `CRITICAL`, `HIGH`, `MEDIUM`, and `LOW` priorities. Items must cite observed evidence from the repository and should favor existing G-VAMS product flows: attendance, performance, timetable, leave, LMS, authentication, maintainability, validation, security, and production readiness.

## Project Health input

The existing Project Health automation remains authoritative for generated health observations. The autonomous agent consumes `docs/PROJECT_HEALTH.md` as an input and must not duplicate or replace `scripts/generate-project-health.js` or `.github/workflows/project-health.yml`.

## Pull request isolation

The autonomous agent must never push arbitrary application changes directly to `main`. Application changes belong on isolated branches and must be proposed through pull requests so CI gates and human maintainers can reject unsafe work.

## What Version 1 automates

Version 1:

- Generates `.agent/generated/AGENT_CONTEXT.md` and `.agent/generated/AGENT_CONTEXT.json`.
- Validates that `DAILY_DECISIONS.json` is valid JSON.
- Runs syntax validation for the context generator.
- Provides a scheduled and manually runnable GitHub Actions workflow that prepares agent context.
- Documents extension points for a real coding-agent runtime.

## What Version 1 intentionally does not automate

Version 1 does not:

- Pretend GitHub Actions is an LLM.
- Randomly or heuristically edit application code.
- Select and implement backlog items without a real coding-agent runtime.
- Push arbitrary application changes to `main`.
- Bypass validation failures.

## Required runtime connection

Unattended daily implementation requires a secure coding-agent runtime with repository credentials scoped to create branches and pull requests, plus any required model/API credentials stored as GitHub Actions secrets. The runtime must consume `.agent/generated/AGENT_CONTEXT.md` or `.agent/generated/AGENT_CONTEXT.json`, follow `AUTONOMOUS_RULES.md`, implement exactly one selected improvement, run validation, update memory, and open a PR.

## Recommended open-source runtime options

- **OpenHands** is the preferred open-source option to evaluate first because it is designed as an autonomous software engineering agent and can operate against repositories with tool execution.
- Other possible options include self-hosted coding-agent orchestrators that can run Codex-style or SWE-agent-style workflows, provided they honor branch isolation, secrets handling, validation, and PR creation requirements.
