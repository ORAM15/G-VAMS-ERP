# @oram/engines

The Intelligence layer — the deterministic, no-AI reasoning that carries an Engineering Cycle through
Observe, Understand, Reason, Decide, and Plan (`docs/ORAM_SPECIFICATION_v1.md` Section 4), plus Learn.

## Responsibility

One sub-package per Engineering Lifecycle phase, each a direct extraction of an existing, proven
`scripts/*.js` engine's *pure logic* (no filesystem/env assumptions):

| Sub-package | Wraps / extracted from |
|---|---|
| `repository-analyzer` (real; two implementations) | (1) `LegacyRepositoryAnalyzerAdapter` — still wraps the real, unmodified `scripts/repository-intelligence.js` verbatim, unchanged since Phase 3. (2) `RepositoryAnalyzerEngine`/`buildRepositoryAnalysis()` (Capability Sprint 1, Milestone 1) — a real, native TypeScript, repository-agnostic implementation with no `scripts/*.js` dependency, producing the richer evidence/confidence-scored `RepositoryAnalysis` shape (`./analysis/types.ts`). Both satisfy the same `EngineDescriptor` contract and the same `stage`/`artifactName` address; either can be wired in as the `observe` engine via `RuntimeBuilder.withObserveEngine()`. |
| `engineering-knowledge` (real; Capability Sprint 1, Phase 2) | `EngineeringKnowledgeEngine`/`buildEngineeringKnowledge()` — a new, independent transformation of `repository-analyzer`'s `RepositoryAnalysis` into subsystems, dependency relationships, an architecture summary/tech-stack narrative, and evidence-based strengths/risks/debt/missing-practice findings (`./analysis/types.ts`'s `EngineeringKnowledge`). Deliberately NOT built on `scripts/engineering-knowledge.js` — that legacy script consumes the *legacy* `repository-analysis.json` shape (its `detectedModules`/school-ERP keyword concept), which the new, repository-agnostic `RepositoryAnalysis` doesn't produce; wrapping it was not an option. `scripts/engineering-knowledge.js` itself is untouched and still valid for the legacy pipeline. |
| `historical-context` (future) | `scripts/historical-context-retriever.js` |
| `recommendation` (future) | `scripts/recommendation-engine.js` |
| `decision` (future) | `scripts/adaptive-decision-engine.js` (`scripts/decision-engine.js` is retired, not migrated — see `ORAM_V3_MIGRATION_PLAN.md` Section 4.3) |
| `execution-planner` (future) | `scripts/execution-planner.js` |
| `work-order` (future) | `scripts/implementation-request-engine.js` |
| `validation` (future) | `scripts/validation-engine.js` |
| `reflection` (future) | `scripts/reflection-engine.js` |
| `run-history` (future) | `scripts/run-history-manager.js` |
| `engineering-memory` (future) | `scripts/engineering-memory.js` |
| `pull-request` (future) | `scripts/pull-request-generator.js` |
| `publisher` (future) | `scripts/github-publisher.js` + `publisher/github/client.js` + `scripts/agent-branch-publish.js` (unified — see migration plan Section 4.2) |

## Explicit non-responsibilities

- Never calls a Provider, never invokes AI/an LLM/embeddings — this is a platform-wide invariant carried
  forward unchanged from every one of today's engines' own header comments.
- Never touches the network or opens a socket.
- Never decides *whether* to persist an artifact or emit an event — that is `@oram/runtime`'s job; an engine
  only computes and returns a value.

## Status

**Phase 3:** `repository-analyzer`'s legacy wrapper went in — see `repository-analyzer.regression.test.ts`
for the regression coverage proving its wrapped behavior is identical to `scripts/repository-intelligence.js`
run directly. That file, its adapter, and its tests are untouched by everything below.

**Capability Sprint 1, Milestone 1 (current):** added a second, independent `repository-analyzer` engine —
`RepositoryAnalyzerEngine`/`buildRepositoryAnalysis()` under `./analysis/` — a real, generic, evidence-based
analyzer (project type, languages, frameworks, API frameworks, package managers, build tools, testing
frameworks, repository structure, entry points, config files, dependency summary, architectural patterns,
monorepo detection, environment files, CI/CD, Docker, infrastructure files, database technology, auth
libraries, AI/LLM libraries, cloud providers, deployment targets — see `./analysis/types.ts`'s
`RepositoryAnalysis`). Deterministic, no LLM/network calls; every detected fact carries `confidence` +
`evidence` + `sourceFiles`, defaulting to `"Unknown"` (singular fields) or an empty array (plural fields)
rather than ever guessing. See `repository-analyzer.v2.test.ts` and `./__fixtures__/` for coverage. Not yet
wired in as the default `observe` engine anywhere (no `@oram/cli` composition exists yet to wire either
implementation in) — available via `createRepositoryAnalyzerEngine()` for whoever composes a Runtime next.

**Capability Sprint 1, Phase 2 (current):** added `engineering-knowledge` — see `EngineeringKnowledgeEngine.ts`'s
own file-level `CONCRETE LIMITATION` note for a real, disclosed Runtime gap this phase ran into but did not
fix: `EngineDescriptor.run(context)` has no `runId`, so an engine cannot read a prior stage's actual persisted
artifact from the `ArtifactStore` for the current run. `createEngineeringKnowledgeEngine()`'s default behavior
works around this by recomputing a fresh `RepositoryAnalysis` internally (same deterministic result, extra
CPU work, no Runtime change) rather than that gap being fixed unilaterally. See `engineering-knowledge.test.ts`
and the shared `../repository-analyzer/__fixtures__/` for coverage.

Every other sub-package in the table above is still scaffolded (README only).
