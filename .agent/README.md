# G-VAMS Autonomous Evolution Agent

Phase 1 created persistent autonomous-agent context and memory. Phase 2A adds deterministic gates and a disabled runtime bridge. No G-VAMS application behavior is changed by this infrastructure phase.

## Phase 1 architecture

The `.agent/` directory stores durable state for future autonomous runs:

- `PROJECT_VISION.md` defines the G-VAMS product direction.
- `AUTONOMOUS_RULES.md` is the engineering constitution.
- `DEVELOPMENT_MEMORY.md` records long-term cycle observations and outcomes.
- `BACKLOG.md` stores prioritized engineering opportunities.
- `DAILY_DECISIONS.json` stores machine-readable decision history.
- `generated/` is produced by `scripts/autonomous-agent-context.js` and is safe to regenerate.

Project Health remains owned by `scripts/generate-project-health.js`, `.github/workflows/project-health.yml`, and `docs/PROJECT_HEALTH.md`.

## Phase 2A deterministic gatekeeper

`scripts/agent-gatekeeper.js` exposes four deterministic stages:

```bash
node scripts/agent-gatekeeper.js input
node scripts/agent-gatekeeper.js decision .agent/runtime/current-decision.json
node scripts/agent-gatekeeper.js diff .agent/runtime/current-decision.json
node scripts/agent-gatekeeper.js result .agent/runtime/runtime-result.json
```

The gatekeeper never uses an LLM.

## Trusted inputs

A future runtime may consume only checked-out repository source, deterministic Git metadata, `docs/PROJECT_HEALTH.md`, and these `.agent` files: `PROJECT_VISION.md`, `AUTONOMOUS_RULES.md`, `DEVELOPMENT_MEMORY.md`, `BACKLOG.md`, `DAILY_DECISIONS.json`, `generated/AGENT_CONTEXT.md`, and `generated/AGENT_CONTEXT.json`.

## Explicitly untrusted and excluded inputs

GitHub issue bodies, issue comments, PR descriptions, PR comments, review comments, Discussions content, arbitrary web pages, and other remote user-generated text are not autonomous instructions. Comment-triggered, @mention-triggered, and label-triggered coding are intentionally not implemented.

## Input gate and secret scan

The input gate verifies required trusted files exist, generated context exists, and package/context JSON is parseable. It scans generated context for obvious private keys, GitHub tokens, cloud access keys, JWT secret assignments, sensitive environment assignments, MongoDB credential URIs, and Google/Gemini API-key-like material. It reports only file, category, and safe line metadata.

## Decision contract and exactly one improvement

`.agent/schemas/decision.schema.json` requires one `selected_improvement`, a stable `cycle_id`, a backlog ID or explicit repository-observed justification, non-empty scope, non-empty `allowed_paths`, planned validation, and strict `risk_level`. The decision gate rejects attempts to authorize secrets, `.env`, Git credentials, private keys, workflows, the constitution, project vision, gatekeeper, adapter, or orchestrator.

## Scope enforcement and protected control plane

Normal autonomous implementation cycles cannot self-authorize modifications to:

- `.agent/AUTONOMOUS_RULES.md`
- `.agent/PROJECT_VISION.md`
- `scripts/agent-gatekeeper.js`
- `scripts/agent-runtime-adapter.js`
- `scripts/agent-cycle.js`
- `.github/workflows/`

Human/Codex-supervised infrastructure PRs may modify these files.

## Diff thresholds

The diff gate rejects empty diffs, out-of-scope application paths, secret-bearing paths, protected control-plane paths, new workflows, workflow permission escalation, and oversized diffs. Defaults in `.agent/runtime/config.json` are 12 changed files and 500 changed lines for one focused daily improvement. Agent state updates allowed outside application scope are narrowly limited to `DEVELOPMENT_MEMORY.md`, `BACKLOG.md`, `DAILY_DECISIONS.json`, generated context, and runtime artifacts.

## Result contract and validation failure handling

`.agent/schemas/runtime-result.schema.json` requires runtime, provider/model metadata, decision artifact path, implementation summary, changed files, validation records, strict outcome, limitations, and next direction. Allowed outcomes are `success`, `failed`, `blocked`, and `no_safe_improvement`. The result gate rejects any `success` that contains failed validation or no changed files.

## Runtime adapter and disabled behavior

`scripts/agent-runtime-adapter.js` is a replaceable runtime boundary. The only implemented mode is `disabled`, which writes a blocked result and performs no code changes. `scripts/agent-cycle.js` treats disabled runtime as blocked and does not create meaningless branches or PRs.

## Branch and PR isolation

The intended successful runtime path uses isolated branches such as `agent/AE-YYYY-MM-DD-001` and opens a PR to `main`. Autonomous PRs are not auto-merged in Phase 2A because deterministic gates and CI still require human review before repository trust is extended to unattended code changes.

## OpenHands and Gemini status

OpenHands is preferred but not connected. Gemini is preferred but not connected. No provider credentials, model identifiers, or unverified commands are committed. See `.agent/runtime/README.md` for the exact Phase 2B activation checklist.

## Exact next activation step

Phase 2B must be a human-supervised infrastructure PR that verifies a current OpenHands unattended execution interface, pins its runtime, configures Gemini through approved secrets/variables, and proves a staged decision-gate-implementation flow without exposing credentials.
