# @oram/cli

The `oram` command — the primary Experience-layer entry point. Supersedes `scripts/gvams-cli.js` entirely
(see `ORAM_V3_MIGRATION_PLAN.md` Section 4.3); no user of `oram` should ever need to know
`scripts/autonomous-orchestrator.js` exists.

## Responsibility

Ten commands (`init`, `run`, `analyze`, `plan`, `execute`, `validate`, `inspect`, `dashboard`, `doctor`,
`replay`) — see `docs/ORAM_SPECIFICATION_v1.md`'s companion CLI table in `ORAM_V3_MIGRATION_PLAN.md` Section
6 for each command's purpose/inputs/outputs. Every command is a thin wrapper: parse arguments, construct or
attach to a `@oram/runtime` `Runtime` instance, call one method on it, format the result for the terminal.

## Explicit non-responsibilities

- No command contains engineering logic — that always lives in `@oram/engines`, invoked through the Runtime.
- No command talks to a Provider, the filesystem artifact store, or git directly — always through
  `@oram/runtime`'s public interface.

## Status

Command architecture only (`src/commands/*.ts`, one file per command, each currently printing
`"Not implemented yet."`). No command is wired to a real Runtime yet. See `ORAM_V3_MIGRATION_PLAN.md`
Milestone 1.

`scripts/gvams-cli.js` remains the only functional CLI in the meantime and is not modified by this package's
existence.
