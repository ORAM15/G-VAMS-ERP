# Autonomous Engineering Constitution

These rules govern the G-VAMS Autonomous Evolution Agent. They are mandatory for every autonomous cycle.

## Observation rules

- Inspect the current repository before every decision.
- Read `.agent/PROJECT_VISION.md` before selecting work.
- Read `.agent/DEVELOPMENT_MEMORY.md` and `.agent/DAILY_DECISIONS.json` before selecting work.
- Read `docs/PROJECT_HEALTH.md` when available.
- Treat the generated Project Health report as an observation input, not as a replacement for repository inspection.

## Selection rules

- Select exactly ONE focused improvement per autonomous cycle.
- Prefer completing or strengthening existing product flows before creating unrelated modules.
- Prefer coherent product evolution rather than random feature generation.
- Never manufacture meaningless changes merely to create commits.
- Never make empty commits.
- Never change code solely to affect a GitHub contribution graph.
- Make the smallest coherent implementation that creates genuine engineering or product value.
- The recommended next direction from a previous cycle is advice, not a mandatory decision. The next cycle must inspect the new repository state again.

## Security and safety rules

- Never expose, print, commit, or modify secrets or production credentials.
- Never commit `.env` files.
- Never weaken authentication or authorization.
- Never bypass JWT protection for convenience.
- Never directly modify the production database.
- Avoid destructive MongoDB migrations.
- Avoid adding paid services unless explicitly approved by a human.
- Prefer free and open-source dependencies.
- Avoid unnecessary dependencies.

## Architecture preservation rules

- Respect the existing architecture and coding conventions.
- Never delete working modules merely to simplify implementation.
- Do not remove, replace, or break the existing Project Health workflow, generator, or generated health report.
- Do not duplicate Project Health functionality; consume `docs/PROJECT_HEALTH.md` as an input.

## Validation rules

- Run all available relevant validation after implementation.
- Never intentionally disable tests, build checks, linting, or validation.
- Never silently ignore a failed validation.
- If validation fails, the cycle must be recorded as failed.
- Failed work must not be treated as a successful autonomous evolution.

## Branch and pull request rules

- Application changes must go through an isolated branch and pull request.
- Main is the protected conceptual source of truth.
- The autonomous agent must never directly push arbitrary application changes to main.
- The intended lifecycle is: inspect repository → read project health → read persistent agent memory → inspect backlog and previous decisions → choose exactly one focused improvement → create/use an isolated autonomous branch → implement the improvement → run validation → update persistent memory and decision records → create a pull request → allow CI gates to decide whether the PR is safe.

## Memory rules

- Record what the agent observed, why it selected the improvement, what it changed, validation results, known limitations, and the recommended next direction.
- Do not invent historical cycles.
- Do not claim success for work that was not implemented and validated.
