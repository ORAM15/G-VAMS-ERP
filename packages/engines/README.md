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
| `engineering-reasoning` (real; Capability Sprint 1, Phase 3, MVP) | `EngineeringReasoningEngine`/`buildEngineeringReasoning()` — analyzes `engineering-knowledge`'s `EngineeringKnowledge` (never `RepositoryAnalysis` directly) via exactly 5 deterministic rules, producing evidence-based `Finding`s (`./analysis/types.ts`). No LLM, no planning/prioritization between Findings. Not built on any legacy script -- no `scripts/*.js` predecessor covers this. |
| `engineering-planning` (real; Capability Sprint 2) | `EngineeringPlanningEngine`/`buildEngineeringPlan()` — maps `engineering-reasoning`'s `Finding`s (never `EngineeringKnowledge`/`RepositoryAnalysis` directly) into `Mission`s via exactly 3 deterministic mapping rules, each aggregating every matching Finding into one Mission with one `MissionTask` per Finding (`./analysis/types.ts`). No LLM, no scheduling/dependency-ordering between Missions. Not built on any legacy script. |
| `engineering-missions` (real; Capability Sprint 5) | `EngineeringMissionsEngine`/`buildMissionGraph()` — turns `engineering-planning`'s `Mission`s (never `EngineeringReasoning`/`EngineeringKnowledge`/`RepositoryAnalysis` directly) into a `MissionGraph`: the same Missions, now carrying `dependencyIds`/`order` plus the graph's own `MissionDependency` edges and `executionOrder` (`./analysis/types.ts`). No AI, no filesystem, no execution -- see `./rules.ts`'s own file-level note on the single linear-chain dependency rule this MVP uses. Not built on any legacy script. |
| `implementation-requests` (real; Capability Sprint 6) | `ImplementationRequestsEngine`/`buildImplementationRequests()` — turns `engineering-missions`' `Mission`s (never `EngineeringPlan`/`EngineeringReasoning`/`EngineeringKnowledge`/`RepositoryAnalysis` directly) into execution-READY `ImplementationRequest`s, exactly one per Mission (`./analysis/types.ts`). No AI, no filesystem, no execution -- see `./rules.ts`'s own file-level note on the text-heuristic `implementationTargets` derivation. Effectively fulfills the future `work-order` row below under a different, more specific name; not built on `scripts/implementation-request-engine.js` (repository-agnostic, no legacy shape dependency). |
| `execution-planning` (real; Capability Sprint 7) | `ExecutionPlanningEngine`/`buildExecutionPlans()` — turns `implementation-requests`' `ImplementationRequest`s (never `MissionGraph`/`EngineeringPlan`/`EngineeringReasoning`/`EngineeringKnowledge`/`RepositoryAnalysis` directly) into `ExecutionPlan`s, exactly one per request, each a deterministic, ordered sequence of `ExecutionStep` templates (`./analysis/types.ts`). No AI, no filesystem, no Runtime, no Providers -- steps describe what should happen, nothing here does it. See `./rules.ts`'s own file-level note on the two disclosed limitations this stage inherited. Effectively fulfills the future `execution-planner` row below under a different name. |
| `implementation-executor` (real; Capability Sprint 8) | `ImplementationExecutorEngine`/`executeAll()`/`ImplementationExecutor.execute()` — walks each `execution-planning` `ExecutionPlan`'s steps, in order, through a `GitAdapter`/`FileAdapter`/`CommandAdapter` (`./adapters/types.ts`), producing one `ExecutionResult` per plan (`./analysis/types.ts`). Two adapter implementations: `MemoryAdapter` (the default -- deterministic, in-memory, zero side effects) and `RealAdapter` (every method throws `NotImplementedYetError`, on purpose; never the default). No AI, no autonomous decisions -- the only "decision" is a fixed rule: stop and skip the rest once a step fails. Deliberately NOT built on the real, existing `scripts/implementation-executor.js` (a genuinely functional legacy component with `EXECUTION_APPROVED`-gated Provider execution, e.g. `claude-code-v1`) -- that script still exists, is untouched, and is not wrapped or superseded by this package; this is a new, repository-agnostic, non-Provider, non-executing sibling, not a migration of it. |
| `provider-execution` (real; Capability Sprint 9) | `ProviderExecutionEngine`/`runAll()` — the layer BEFORE any real change could ever happen: turns each `execution-planning` `ExecutionStep` into a `PromptArtifact` (`./analysis/build-prompt.ts`), calls a `Provider.generate()` (`./providers/types.ts`) to get an `LLMResponse`, and wraps that as a `PatchArtifact` -- a plain, unparsed, unvalidated container (`./analysis/build-patch.ts`). Two categories of `Provider`: `MemoryProvider` (the default -- deterministic canned responses, no AI calls) and `ClaudeProvider`/`GeminiProvider`/`OpenAIProvider` (every method throws the SAME `NotImplementedYetError` reused, read-only, from `implementation-executor`'s `RealAdapter`; never the default). Generates AI requests and captures AI responses ONLY -- never modifies git, the filesystem, or runs a shell command; never applies a patch (Validation and Application are both explicitly future-sprint work). |
| `historical-context` (future) | `scripts/historical-context-retriever.js` |
| `recommendation` (real; Capability Sprint 11) | `RecommendationEngine`/`buildRecommendationSet()` — maps each `validation`'s `ValidationIssue` (never `PatchArtifact`/`unifiedDiff` directly) to exactly one `Recommendation`, keyed by a fixed, deterministic template table off the issue's own `title` (`./analysis/rules.ts`); an unrecognized title falls back to an honest generic recommendation rather than guessing. `Recommendation.priority` is carried 1:1 from the source issue's own `severity` -- never a separately invented ranking. No AI, no filesystem, no re-evaluation of any patch. Deliberately NOT built on the real, existing `scripts/recommendation-engine.js` (a genuinely functional legacy component that reads `engineering-knowledge/engineering-knowledge.json` and produces scored, ranked recommendations from it) -- that script still exists, is untouched, and is not wrapped or superseded by this package; this is a new, repository-agnostic sibling operating on today's `ValidationIssue` shape instead. |
| `decision` (future) | `scripts/adaptive-decision-engine.js` (`scripts/decision-engine.js` is retired, not migrated — see `ORAM_V3_MIGRATION_PLAN.md` Section 4.3) |
| `execution-planner` (future; see `execution-planning` above) | `scripts/execution-planner.js` |
| `work-order` (future; see `implementation-requests` above) | `scripts/implementation-request-engine.js` |
| `validation` (real; Capability Sprint 10) | `ValidationEngine`/`validateAll()` — evaluates `provider-execution`'s `PatchArtifact`s (never generates, applies, or executes anything) into `ValidationReport`s via six deterministic, plain-text structural rules (`./analysis/rules.ts`): empty patch, placeholder diff, diff too large, missing file headers, invalid (mismatched-count) unified diff header, duplicate hunks. No AST, no compilation, no execution, no patch application, no filesystem writes. Deliberately NOT built on the real, existing `scripts/validation-engine.js` (a genuinely functional legacy component that reads `implementation-request.json`/`execution.json`/`patch-summary.json` off disk and cross-checks them against each other) -- that script still exists, is untouched, and is not wrapped or superseded by this package; this is a new, repository-agnostic sibling operating on today's `PatchArtifact` shape instead. |
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

**Capability Sprint 1, Phase 3, MVP (current):** added `engineering-reasoning` -- exactly 5 rules
(`subsystem-concentration`, `untested-api-surface`, `unverified-monorepo`, `subsystem-api-without-auth`,
`opaque-subsystems`), each chosen because it reasons over MULTIPLE `EngineeringKnowledge` facts together
(concentration across relationships, severity escalated by structural context, per-subsystem correlation)
rather than repeating a single fact `EngineeringKnowledge`'s own rules already report. See
`EngineeringReasoningEngine.ts`'s own file-level `CONCRETE LIMITATION` note for two disclosed gaps this
phase ran into but did not fix unilaterally: the same `runId`-less `EngineDescriptor.run()` gap noted below
for `engineering-knowledge`, and the absence of any `@oram/events` type for "Findings produced" (the closest
existing type, `RecommendationsGeneratedEvent`, is reused with an honestly-`null` `topOpportunityId` rather
than a fabricated fit). See `engineering-reasoning.test.ts` and `./__fixtures__/concentrated-monorepo/` (plus
the shared `../repository-analyzer/__fixtures__/`, including one existing fixture that turns out to
genuinely trigger 3 of the 5 rules) for coverage.

**Capability Sprint 2 (current):** added `engineering-planning` -- exactly 3 Finding -> Mission mapping rules
(`improve-subsystem-documentation` matches `Finding.kind === "opaque-subsystems"`; `increase-test-coverage`
matches `Finding.category === "testing-gap"`; `refactor-circular-dependencies` matches
`Finding.kind === "circular-dependencies"`). See `./rules.ts`'s own file-level `CONCRETE LIMITATION` note: the
first two mappings are real and can genuinely fire against today's `engineering-reasoning` output; the third
cannot yet, because Engineering Reasoning has no dependency-cycle detection -- it is included because it was
an explicitly requested initial mapping, verified correct via a unit test against a hand-built Finding, and
will activate automatically once a future Engineering Reasoning rule adds that detection (not added here,
per this project's "explain a limitation before implementing a new abstraction" rule). See
`EngineeringPlanningEngine.ts`'s own file-level `CONCRETE LIMITATION` note for the same disclosed
`runId`-less `EngineDescriptor.run()` gap and `@oram/events` vocabulary gap already noted for
`engineering-reasoning`, one stage further down. See `engineering-planning.test.ts` and
`../engineering-reasoning/__fixtures__/concentrated-monorepo/` (plus the shared
`../repository-analyzer/__fixtures__/`) for coverage, including a stored JSON snapshot of a full
`EngineeringPlan`.

**Capability Sprint 5 (current):** added `engineering-missions` -- each `EngineeringPlan` Mission becomes one
`Mission` graph node, in the same order Engineering Planning already produced them, connected by a single
deterministic rule: each Mission depends on exactly the one before it (a linear chain), recorded both as
`Mission.dependencyIds` and as first-class `MissionDependency` edges, with `MissionGraph.executionOrder`
giving a valid topological order. See `./rules.ts`'s own file-level `CONCRETE LIMITATION` note: this is an
honest default sequencing over the Plan's existing order, not a claim of discovered real-world work
dependencies -- EngineeringPlan carries no such data, and inventing one would be fabrication. Its own `Mission`
type is engineering-planning's `Mission` plus `dependencyIds`/`order`; re-exported from `@oram/engines` as
`MissionNode` to avoid colliding with engineering-planning's `Mission` (see `../index.ts`'s own comment).
See `EngineeringMissionsEngine.ts`'s own file-level `CONCRETE LIMITATION` note for the same disclosed
`runId`-less `EngineDescriptor.run()` gap and `@oram/events` vocabulary gap already noted for
`engineering-planning`, one stage further down. See `engineering-missions.test.ts` (including a stored JSON
snapshot of a full `MissionGraph`) for coverage. Does not implement execution -- that is explicitly out of
scope for this Sprint.

**Capability Sprint 6 (current):** added `implementation-requests` -- each `MissionGraph` Mission becomes
exactly one `ImplementationRequest`, in the graph's own `executionOrder`, carrying its Mission's
`id`/`title`/`priority`/`rationale`/`expectedImpact`/`estimatedEffort` unchanged plus a synthesized `goal`
(`title -- expectedImpact`, concatenated verbatim), `acceptanceCriteria` (one per `MissionTask`, its own
description framed as a completion statement), and `constraints` (one universal + one per Mission `kind`,
both templated, never fabricated per-run). See `./rules.ts`'s own file-level `CONCRETE LIMITATION` note for
two disclosed gaps: `implementationTargets[].subsystem` is extracted via a text-heuristic regex over each
MissionTask's own description (verified against all 5 Engineering Reasoning Finding summary templates, zero
false positives today, but still a heuristic, not a structural join -- MissionGraph carries no subsystem-id
references), and `implementationTargets[].files` is always `[]` (MissionGraph carries no file-level
provenance at all to derive it from). See `ImplementationRequestsEngine.ts`'s own file-level
`CONCRETE LIMITATION` note for the same disclosed `runId`-less `EngineDescriptor.run()` gap and `@oram/events`
vocabulary gap already noted for `engineering-missions`, one stage further down. See
`implementation-requests.test.ts` (including a stored JSON snapshot of a full `ImplementationRequestSet`) for
coverage. Does not implement execution -- this stage only prepares execution-ready requests, per this
Sprint's explicit scope.

**Capability Sprint 7 (current):** added `execution-planning` -- each `ImplementationRequest` becomes exactly
one `ExecutionPlan`, carrying `requestId`/`title`/`priority` and a deterministic 4-step sequence
(`CREATE_BRANCH` -> a title-templated creation/modification step -> `RUN_TESTS` -> `COMMIT`), plus a linear
`dependencyIds` chain over the request set's own order (mirroring `engineering-missions`' identical
solution one stage up). See `./rules.ts`'s own file-level `CONCRETE LIMITATION` note for two disclosed gaps,
both consequences of Sprint 6 not carrying certain fields forward: the creation/modification step is looked
up by `ImplementationRequest.title` (a small, fixed, fully known set of strings) rather than a `Mission.kind`
field, which Sprint 6 never carried onto `ImplementationRequest`; and `dependencyIds` are a default linear
sequence, not real dependency data, because Sprint 6 never carried `MissionGraph`'s `dependencyIds`/
`MissionDependency` edges onto `ImplementationRequest` either. Both fall back honestly (a generic
`MODIFY_FILE` template for any unrecognized title) rather than guessing. See
`ExecutionPlanningEngine.ts`'s own file-level `CONCRETE LIMITATION` note for the same disclosed `runId`-less
`EngineDescriptor.run()` gap and `@oram/events` vocabulary gap already noted for `implementation-requests`,
one stage further down. See `execution-planning.test.ts` (including a stored JSON snapshot of a full
`ExecutionPlanSet`) for coverage. Steps are templates only -- this package reads no file, writes no file,
spawns no process, and calls no Provider; "Execution Planning must NOT modify files. Execution Planning must
NOT execute commands."

**Capability Sprint 8 (current):** added `implementation-executor` -- the first package in this pipeline that
actually *runs* something, even though by default it runs nothing real. `ImplementationExecutor.execute(plan)`
walks one `ExecutionPlan`'s steps in order, dispatching each to a `GitAdapter`/`FileAdapter`/`CommandAdapter`
(one of 3 categories covering all 9 `ExecutionAction` kinds) and recording an `ExecutionStepResult`; the
first step to FAIL causes every remaining step to be recorded SKIPPED, and the overall `ExecutionResult`
carries a single `ExecutionFailure` naming the step that actually failed. `MemoryAdapter` -- the default for
both `ImplementationExecutor` and `ImplementationExecutorEngine` -- always reports SUCCESS deterministically
without touching git, the filesystem, or a shell; `RealAdapter` exists only as a stub whose every method
throws `NotImplementedYetError`, so it can never run something real by accident. No `ExecutionResultSet`
aggregate type exists (see `./analysis/types.ts`'s own header comment) -- this Sprint's own spec asked only
for the singular types plus `execute(plan)`; running a whole `ExecutionPlanSet` is the thin `executeAll()`
helper, not a new named artifact. See `implementation-executor.test.ts` for coverage, including a stored
JSON snapshot, explicit failure-handling tests (both an adapter-returned FAILED and an adapter that throws),
and a zero-step-plan test. Does not modify Runtime; does not execute real git/npm/filesystem commands under
any default configuration.

**Capability Sprint 9 (current):** added `provider-execution` -- the first package to model what an actual
AI-assisted code change would look like, while still never making one. `ProviderExecutionEngine.run(plan)`
walks a single `execution-planning` `ExecutionPlan`'s steps and, per step: builds a `PromptArtifact` (a fixed
system prompt + a userPrompt whose first line is a self-controlled `Action: X` format), calls the injected
`Provider.generate()`, and wraps the resulting `LLMResponse` as a `PatchArtifact`. `MemoryProvider` -- the
default for both the class and `createProviderExecutionEngine()` -- returns a deterministic canned response
keyed by that same `Action: X` line (recovered via a fixed regex over a format this package itself defines,
not free-text scraping of prose it doesn't control); an unrecognized action falls back to a generic summary
rather than guessing. `PatchArtifact` is enforced as a container ONLY: `unifiedDiff` is `response.rawText`
verbatim, and `language`/`summary` are never inferred by inspecting that text (see `./analysis/build-patch.ts`'s
own note) -- doing so would itself be parsing, which this Sprint explicitly excludes. No
`ProviderExecutionEngineEngine.ts` wrapper file exists; `createProviderExecutionEngine()` (the same
`EngineDescriptor` factory pattern every prior stage provides) is co-located in `ProviderExecutionEngine.ts`
itself, disclosed there, since this Sprint's own spec names the core worker class the same name every prior
stage reserved for its EngineDescriptor wrapper. See `provider-execution.test.ts` (including a stored JSON
snapshot and an explicit test that `ProviderExecutionEngine` propagates rather than swallows a
`ClaudeProvider` throw) for coverage. No CLI command was added -- none was requested this Sprint.

**Capability Sprint 10 (current):** added `validation` -- the first package to actually look at a
`PatchArtifact`'s content, but only via lightweight, deterministic structural checks, never execution.
`ValidationEngine.validate(patch)` runs all six rules (`./analysis/rules.ts`) against one patch and
`buildValidationReport()` (`./analysis/build-validation-report.ts`) turns whatever fired into a scored
`ValidationReport`: 100 minus a fixed per-issue deduction by severity (`ERROR` 40, `WARNING` 15, `INFO` 5),
clamped at 0; `passed` is strictly "no `ERROR`-severity issue," so a patch can carry `WARNING`/`INFO` issues
and still pass. Against real `MemoryProvider` output this is exactly what happens: every simulated patch's
diff contains the literal `PLACEHOLDER` marker, so `validateAll()` on real pipeline output consistently
produces `passed: true, score: 85` reports carrying one `WARNING` -- an honest signal that the content is
simulated, not a false failure. `ValidationSeverity` is deliberately its own type name, not reusing
`engineering-reasoning`'s already-exported `Severity`, to avoid the same kind of barrel collision
`engineering-missions`' `Mission` had against `engineering-planning`'s `Mission` (see that package's own
header comment for the precedent). No `ValidationEngineEngine.ts` wrapper file exists, for the same reason
Sprint 9 co-located `createProviderExecutionEngine()` in `ProviderExecutionEngine.ts`: this Sprint's own spec
names the core worker class itself `ValidationEngine`. See `validation.test.ts` (17 tests, including a stored
JSON snapshot, the missing-vs-invalid-header distinction, and identity determinism) for coverage. No Runtime
changes, no EngineRunner changes, no CLI modifications -- none were requested this Sprint.

**Capability Sprint 11 (current):** added `recommendation` -- turns each `validation` `ValidationIssue` into
one actionable `Recommendation` via a fixed, deterministic title -> template lookup
(`./analysis/rules.ts`, the same "dispatch by upstream text" technique `execution-planning`'s own rules.ts
uses for `ImplementationRequest.title`). `Recommendation.priority` is carried 1:1 from the source issue's own
`severity` -- never a separately invented ranking -- and `confidence` is a fixed number per template, never
computed from anything probabilistic. Against real `MemoryProvider`/`MemoryAdapter` pipeline output this
means every one of `validation`'s `PLACEHOLDER`-flagged `WARNING` issues becomes a "Replace placeholder
content..." recommendation, deterministically. `RecommendationSeverity` is its own type (mirroring
`ValidationSeverity`'s shape, not reusing it) for the same barrel-collision-avoidance reason `validation`
gave for not reusing `engineering-reasoning`'s `Severity`. No `RecommendationEngineEngine.ts` wrapper file
exists, for the same reason Sprints 9-10 co-located their own EngineDescriptor factories. `RecommendationsGeneratedEvent`
is reused the same honest way every prior stage reused it -- `topOpportunityId` stays `null` even though the
name reads like a natural fit, because that field is typed `number | null` while every id in this pipeline is
a string (see `RecommendationEngine.ts`'s own header comment). Also added the CLI's `oram recommend <path>`
command (`packages/cli/src/commands/recommend.ts` + `renderRecommendationsReport.ts`), the first command
since Sprint 8's `execute` to run the pipeline all the way through Provider Execution and Validation as well.
Deliberately NOT built on the real, existing `scripts/recommendation-engine.js` -- see the table row above.
See `recommendation.test.ts` (13 tests, including a stored JSON snapshot and identity determinism) plus the
CLI's own `renderRecommendationsReport.test.ts` for coverage. No Runtime changes, no EngineRunner changes, no
modifications to any protected package (Repository Analysis through Validation) -- only additive CLI files.

Every other sub-package in the table above is still scaffolded (README only).
