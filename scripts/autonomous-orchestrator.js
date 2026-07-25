#!/usr/bin/env node
// Autonomous Engineering Orchestrator v1
//
// NOT another pipeline engine -- the conductor that runs the existing, frozen stages in sequence:
//   Repository Intelligence -> Engineering Knowledge -> Recommendation Engine -> Decision Engine ->
//   Implementation Request Engine -> [ Implementation Executor -> Validation Engine -> Reflection Engine ]
//   (repeated up to GVAMS_MAX_ITERATIONS times) -> Pull Request Generator -> GitHub Publisher Adapter
// Each stage is invoked exactly as its own CLI (`node scripts/<stage>.js`), inheriting the current
// environment untouched -- this orchestrator never sets, forges, or bypasses any stage's own safety gates
// (e.g. it does NOT inject EXECUTION_APPROVED or GITHUB_PUBLISH_DRY_RUN=false on anyone's behalf; if a human
// hasn't approved execution, Implementation Executor will legitimately report "blocked" exactly as it always
// does). A stage's own exit code is the only signal this orchestrator trusts for the once-only stages -- it
// never re-interprets or second-guesses why a stage succeeded or failed.
//
// If any once-only stage exits non-zero, the run stops immediately and every remaining stage is recorded
// SKIPPED.
//
// ITERATION LOOP (Implementation Executor / Validation Engine / Reflection Engine): re-running Repository
// Intelligence through Implementation Request Engine would be pointless -- they are pure functions of
// already-fixed repository/decision state and would deterministically reselect the exact same recommendation
// every time, since nothing in this v1 architecture writes real code changes back into the analyzed
// repository. Only execution itself can vary between attempts (most plausibly with a real provider), so only
// that three-stage trio repeats. Within the loop, a stage's raw exit code is still recorded honestly
// (Implementation Executor "blocked" or Validation Engine "rejected" are legitimate non-zero exits), but loop
// CONTINUATION is decided from the trio's own structured output instead: validation.json's approvedForPR
// (success -> exit the loop, proceed to publish) and reflection-report.json's retryRecommended (true and
// iterations remain -> attempt again; false, or Reflection Engine itself could not run -- a genuine
// infrastructure failure, not a business outcome -- -> stop). Pull Request Generator and GitHub Publisher
// Adapter only ever run once, after the loop actually reaches an approved validation -- never once per
// iteration, since only one pull request should ever be opened per run.
//
// Run with:   node scripts/autonomous-orchestrator.js
// Output dir defaults to `run/` at the repository root; override with RUN_OUTPUT_DIR.
// Max iterations of the Implementation Executor/Validation Engine/Reflection Engine loop defaults to 1
// (identical, single-pass behavior to before this feature existed); override with GVAMS_MAX_ITERATIONS.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const outputDir = path.resolve(root, process.env.RUN_OUTPUT_DIR || "run");

const DEFAULT_MAX_ITERATIONS = 1;
const maxIterations = (() => {
  const raw = Number(process.env.GVAMS_MAX_ITERATIONS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_MAX_ITERATIONS;
})();

// Split at the point Historical Context Retriever is inserted (see HISTORICAL_CONTEXT_STAGE below): the two
// halves still stop-on-fail exactly like a single UPFRONT_STAGES array always has, but Historical Context
// Retriever itself sits between them with its own non-blocking contract.
const UPFRONT_STAGES_BEFORE_HISTORICAL_CONTEXT = [
  { name: "Repository Intelligence", script: "repository-intelligence.js" },
  { name: "Engineering Knowledge", script: "engineering-knowledge.js" },
];
// Decision Engine v1 has been replaced by Adaptive Decision Engine v2 (scripts/adaptive-decision-engine.js)
// in this pipeline slot -- it still writes decision/decision.json in Decision Engine v1's own exact shape
// (see adaptive-decision-engine.js's buildCompatDecision()), so Implementation Request Engine and every
// other surrounding stage need no changes at all. scripts/decision-engine.js itself is untouched and still
// runs standalone (`node scripts/decision-engine.js`, and several other engines' own end-to-end test
// fixtures still spawn it directly) -- only this orchestrator's own stage slot was swapped.
// Execution Planner v1 sits between Adaptive Decision Engine and Implementation Request Engine -- an
// ordinary spawned, stop-on-fail upfront stage (this task's own spec gives it no special non-blocking
// failure policy, unlike Historical Context Retriever/Run History Manager/Engineering Memory: missing
// OPTIONAL inputs of its own -- recommendations.json/repository-analysis.json/engineering-knowledge.json --
// are handled entirely inside execution-planner.js itself, degrading to the best available plan; only its
// one required input, decision/adaptive-decision.json, can make it exit non-zero, and that file is always
// produced by the stage immediately before it). It writes a standalone execution-plan/ artifact that
// Implementation Request Engine does not read -- inserted without changing any downstream stage.
const UPFRONT_STAGES_AFTER_HISTORICAL_CONTEXT = [
  { name: "Recommendation Engine", script: "recommendation-engine.js" },
  { name: "Adaptive Decision Engine", script: "adaptive-decision-engine.js" },
  { name: "Execution Planner", script: "execution-planner.js" },
  { name: "Implementation Request Engine", script: "implementation-request-engine.js" },
];

// The repeatable trio. Order matters: Reflection Engine must run last, since it reads Validation Engine's
// own output.
const LOOP_STAGES = [
  { name: "Implementation Executor", script: "implementation-executor.js" },
  { name: "Validation Engine", script: "validation-engine.js" },
  { name: "Reflection Engine", script: "reflection-engine.js" },
];

const FINAL_STAGES = [
  { name: "Pull Request Generator", script: "pull-request-generator.js" },
  { name: "GitHub Publisher Adapter", script: "github-publisher.js" },
];

// Run History Manager runs unconditionally once the loop concludes (approved, rejected, or exhausted) and
// before the publish stages -- "every autonomous execution should leave behind a complete historical
// snapshot," including a failed or not-retried one. Unlike every other stage it is called in-process (via
// require(), not spawned as a subprocess) since its real value is the rich, already-in-memory run data the
// orchestrator holds (stage timings, captured console output) -- exactly the same in-process-require pattern
// already used for Provider/Publisher Adapters elsewhere in this pipeline (see resolveProvider() in
// implementation-executor.js, resolvePublisherClient() here for github-publisher.js's own stage). Its own
// failure NEVER stops the run (see runHistoryStage()) -- Run History Manager must never crash the orchestrator.
const HISTORY_STAGE = { name: "Run History Manager", script: "run-history-manager.js" };

// Engineering Memory runs immediately after Run History Manager, for the same reason and with the same
// non-blocking contract: it reads whatever runs/ now contains (including the run Run History Manager just
// archived) and is unconditional/never crashes the orchestrator (see runMemoryStage()). It is NOT an AI
// component -- deterministic JSON analysis only (no embeddings, no vector database, no LLM) -- and, like
// Run History Manager, is called in-process via require(), never spawned as a subprocess.
const MEMORY_STAGE = { name: "Engineering Memory", script: "engineering-memory.js" };

// Historical Context Retriever sits between Engineering Knowledge and Recommendation Engine -- its whole
// purpose is to ground new recommendations in what has already been tried, so it must run BEFORE
// Recommendation Engine, not after (unlike Run History Manager/Engineering Memory, which run once a whole
// run is already complete). Its own failure policy is explicitly non-blocking ("log 'Historical Context
// failed', continue execution") -- unlike a normal upfront stage, which would stop the whole run -- so, like
// Run History Manager/Engineering Memory, it is called in-process via require() with its own dedicated
// runHistoricalContextStage(), never spawned as a subprocess and never able to set `stopped`.
const HISTORICAL_CONTEXT_STAGE = { name: "Historical Context Retriever", script: "historical-context-retriever.js" };

// Flat view of every stage this orchestrator can run, in their natural single-pass order. Iteration 2+ of
// the loop is captured separately in run.json's `iterations` field (see runOrchestration()) -- this flat
// list always reflects the upfront stages (with Historical Context Retriever between Engineering Knowledge
// and Recommendation Engine) plus the FINAL (decisive) loop attempt plus Run History Manager plus
// Engineering Memory plus the publish stages.
const UPFRONT_STAGES = [...UPFRONT_STAGES_BEFORE_HISTORICAL_CONTEXT, HISTORICAL_CONTEXT_STAGE, ...UPFRONT_STAGES_AFTER_HISTORICAL_CONTEXT];
const STAGES = [...UPFRONT_STAGES, ...LOOP_STAGES, HISTORY_STAGE, MEMORY_STAGE, ...FINAL_STAGES];

// Every artifact any stage might produce, relative to the repository root. Existence-checked only -- this
// orchestrator never opens or parses any of these; validating their content is each producing engine's own
// job, not this conductor's.
const KNOWN_ARTIFACTS = [
  "repository-intelligence/repository-analysis.json",
  "repository-intelligence/repository-analysis.md",
  "engineering-knowledge/engineering-knowledge.json",
  "engineering-knowledge/engineering-knowledge.md",
  "historical-context/historical-context.json",
  "historical-context/historical-context.md",
  "recommendations/recommendations.json",
  "recommendations/recommendations.md",
  "decision/decision.json",
  "decision/decision.md",
  "decision/adaptive-decision.json",
  "decision/adaptive-decision.md",
  "execution-plan/execution-plan.json",
  "execution-plan/execution-plan.md",
  "implementation-request/implementation-request.json",
  "implementation-request/implementation-request.md",
  "execution/execution.json",
  "execution/execution.md",
  "execution/patch-summary.json",
  "validation/validation.json",
  "validation/validation.md",
  "reflection/reflection-report.json",
  "reflection/reflection-report.md",
  "memory/engineering-memory.json",
  "memory/report.md",
  "pull-request/pull-request.json",
  "pull-request/pull-request.md",
  "publish/publish.json",
  "publish/publish.md",
];

function truncate(text, max) {
  const value = typeof text === "string" ? text : "";
  return value.length > max ? `${value.slice(0, max)}... (truncated)` : value;
}

function resolveSpawnFn(deps) {
  return (deps && deps.spawnFn) || spawnSync;
}

function resolveMaxIterations(deps) {
  if (deps && deps.maxIterations) return deps.maxIterations;
  return maxIterations;
}

/**
 * Runs a single stage as its own real CLI subprocess (`node scripts/<stage>.js`), capturing its exit code,
 * timing, and truncated stdout/stderr. The stage's exit code is the only signal trusted: 0 is PASS, anything
 * else (including a spawn-level error, e.g. the script file being missing) is FAIL.
 * @param {{name: string, script: string}} stage
 * @param {{spawnFn?: Function, cwd?: string, env?: object, nodeBin?: string}} [deps]
 * @returns {{name: string, script: string, status: string, exitCode: (number|null), startTime: string, endTime: string, durationMs: number, stdout: string, stderr: string}}
 */
function runStage(stage, deps) {
  const spawnFn = resolveSpawnFn(deps);
  const nodeBin = (deps && deps.nodeBin) || process.execPath;
  const scriptPath = path.join((deps && deps.cwd) || root, "scripts", stage.script);
  const startTime = new Date().toISOString();
  const startedAt = Date.now();
  const result = spawnFn(nodeBin, [scriptPath], { cwd: (deps && deps.cwd) || root, encoding: "utf8", env: (deps && deps.env) || process.env });
  const durationMs = Date.now() - startedAt;
  const endTime = new Date().toISOString();

  const spawnErrorMessage = result && result.error ? result.error.message : null;
  const exitCode = result ? result.status : null;
  const ok = !spawnErrorMessage && exitCode === 0;

  return {
    name: stage.name,
    script: stage.script,
    status: ok ? "PASS" : "FAIL",
    exitCode,
    startTime,
    endTime,
    durationMs,
    stdout: truncate((result && result.stdout) || "", 2000),
    stderr: truncate((result && result.stderr) || spawnErrorMessage || "", 2000),
  };
}

function skipStage(stage, deps) {
  const skipped = { name: stage.name, script: stage.script, status: "SKIPPED", exitCode: null, startTime: null, endTime: null, durationMs: null, stdout: "", stderr: "" };
  if (deps && deps.onStageEvent) deps.onStageEvent({ phase: "skip", stage });
  return skipped;
}

function runOne(stage, deps, iteration) {
  if (deps && deps.onStageEvent) deps.onStageEvent({ phase: "start", stage, iteration });
  const result = runStage(stage, deps);
  if (deps && deps.onStageEvent) deps.onStageEvent({ phase: "end", stage, result, iteration });
  return result;
}

/**
 * Runs Historical Context Retriever, in-process, between Engineering Knowledge and Recommendation Engine --
 * grounding the recommendation about to be generated in what has already been tried. Never throws and never
 * sets the orchestrator's `stopped` flag -- a failure is logged ("Historical Context failed") and the run
 * continues exactly as if it had succeeded, per this engine's own explicit non-blocking contract (identical
 * in shape to runHistoryStage()/runMemoryStage(), even though it runs much earlier in the pipeline).
 * @param {{cwd?: string, historicalContextRetriever?: {retrieveSync: Function}, historicalContextRepositoryAnalysisPath?: string, historicalContextEngineeringMemoryPath?: string, historicalContextRunsDir?: string, historicalContextOutputDir?: string}} [deps]
 *   deps.historicalContextRetriever lets tests inject a fake module without needing a real failure mode.
 * @returns {{name: string, script: string, status: string, exitCode: null, startTime: string, endTime: string, durationMs: number, stdout: string, stderr: string, historicalContext: (object|null)}}
 */
function runHistoricalContextStage(deps) {
  const startTime = new Date().toISOString();
  const startedAt = Date.now();
  let status = "PASS";
  let stdout = "";
  let stderr = "";
  let historicalContext = null;
  try {
    const historicalContextRetriever = (deps && deps.historicalContextRetriever) || require("./historical-context-retriever");
    const result = historicalContextRetriever.retrieveSync({
      repositoryAnalysisPath: deps && deps.historicalContextRepositoryAnalysisPath,
      engineeringMemoryPath: deps && deps.historicalContextEngineeringMemoryPath,
      runsDir: deps && deps.historicalContextRunsDir,
      outputDir: deps && deps.historicalContextOutputDir,
    });
    stdout = `Query "${result.context.query}" -- ${result.context.matchingRuns.length} matching run(s); wrote ${path.relative(root, result.jsonPath)}`;
    historicalContext = { query: result.context.query, matchingRuns: result.context.matchingRuns.length, confidence: result.context.confidence, jsonPath: result.jsonPath };
  } catch (error) {
    status = "WARN";
    stderr = `Historical Context failed: ${error.message}`;
    console.error("Historical Context failed:", error.message);
  }
  const durationMs = Date.now() - startedAt;
  const endTime = new Date().toISOString();
  return { name: HISTORICAL_CONTEXT_STAGE.name, script: HISTORICAL_CONTEXT_STAGE.script, status, exitCode: null, startTime, endTime, durationMs, stdout, stderr, historicalContext };
}

/**
 * Reads validation.json's approvedForPR/score and reflection-report.json's retryRecommended off disk after
 * one iteration of the loop trio has run -- the structured signals loop continuation (and, once the loop
 * concludes, Run History Manager's own metadata/metrics) are built from. Missing or unparseable files (e.g.
 * because Reflection Engine itself failed to run) are treated as "not approved, do not retry, no score" --
 * never guessed at.
 * @param {{cwd?: string}} [deps]
 * @returns {{approvedForPR: boolean, retryRecommended: boolean, validationScore: (number|null)}}
 */
function defaultReadIterationOutcome(deps) {
  const cwd = (deps && deps.cwd) || root;
  let approvedForPR = false;
  let validationScore = null;
  let retryRecommended = false;
  try {
    const validation = JSON.parse(fs.readFileSync(path.join(cwd, "validation", "validation.json"), "utf8"));
    approvedForPR = validation.approvedForPR === true;
    validationScore = typeof validation.score === "number" ? validation.score : null;
  } catch (error) {
    approvedForPR = false;
    validationScore = null;
  }
  try {
    const reflection = JSON.parse(fs.readFileSync(path.join(cwd, "reflection", "reflection-report.json"), "utf8"));
    retryRecommended = reflection.retryRecommended === true;
  } catch (error) {
    retryRecommended = false;
  }
  return { approvedForPR, retryRecommended, validationScore };
}

function resolveReadIterationOutcome(deps) {
  return (deps && deps.readIterationOutcome) || defaultReadIterationOutcome;
}

/**
 * Runs Run History Manager once the implementation loop has concluded (approved, rejected, or exhausted),
 * archiving a complete snapshot of the run so far. Never throws and never sets the orchestrator's `stopped`
 * flag -- Run History Manager failing to archive is logged ("History generation failed") and the run
 * continues exactly as if it had succeeded, per this engine's own explicit non-blocking contract.
 * @param {{cwd?: string, runHistoryManager?: {archiveRunSync: Function}}} [deps] deps.runHistoryManager lets
 *   tests inject a fake module (e.g. one whose archiveRunSync throws) without needing a real failure mode.
 * @param {object} historyContext the context object passed straight through to archiveRunSync()
 * @returns {{name: string, script: string, status: string, exitCode: null, startTime: string, endTime: string, durationMs: number, stdout: string, stderr: string, runHistory: (object|null)}}
 */
function runHistoryStage(deps, historyContext) {
  const startTime = new Date().toISOString();
  const startedAt = Date.now();
  let status = "PASS";
  let stdout = "";
  let stderr = "";
  let runHistory = null;
  try {
    const runHistoryManager = (deps && deps.runHistoryManager) || require("./run-history-manager");
    const result = runHistoryManager.archiveRunSync(historyContext);
    stdout = `Archived ${result.archivedFiles.length} artifact(s) to ${path.relative(historyContext.sourceDir || root, result.runDir)}`;
    runHistory = { runId: result.runId, runDir: result.runDir, archivedFiles: result.archivedFiles };
  } catch (error) {
    status = "WARN";
    stderr = `History generation failed: ${error.message}`;
    console.error("History generation failed:", error.message);
  }
  const durationMs = Date.now() - startedAt;
  const endTime = new Date().toISOString();
  return { name: HISTORY_STAGE.name, script: HISTORY_STAGE.script, status, exitCode: null, startTime, endTime, durationMs, stdout, stderr, runHistory };
}

/**
 * Runs Engineering Memory once Run History Manager has archived the run, analyzing whatever runs/ now
 * contains. Never throws and never sets the orchestrator's `stopped` flag -- a failure is logged
 * ("Engineering Memory failed") and the run continues exactly as if it had succeeded, per this engine's own
 * explicit non-blocking contract (identical to Run History Manager's own).
 * @param {{cwd?: string, engineeringMemory?: {analyzeSync: Function}, memoryRunsDir?: string, memoryOutputDir?: string}} [deps]
 *   deps.engineeringMemory lets tests inject a fake module without needing a real failure mode.
 * @returns {{name: string, script: string, status: string, exitCode: null, startTime: string, endTime: string, durationMs: number, stdout: string, stderr: string, engineeringMemory: (object|null)}}
 */
function runMemoryStage(deps) {
  const startTime = new Date().toISOString();
  const startedAt = Date.now();
  let status = "PASS";
  let stdout = "";
  let stderr = "";
  let engineeringMemory = null;
  try {
    const engineeringMemoryModule = (deps && deps.engineeringMemory) || require("./engineering-memory");
    const result = engineeringMemoryModule.analyzeSync({ runsDir: deps && deps.memoryRunsDir, outputDir: deps && deps.memoryOutputDir });
    stdout = `Analyzed ${result.memory.runsAnalyzed} run(s); wrote ${path.relative(root, result.jsonPath)}`;
    engineeringMemory = { runsAnalyzed: result.memory.runsAnalyzed, jsonPath: result.jsonPath };
  } catch (error) {
    status = "WARN";
    stderr = `Engineering Memory failed: ${error.message}`;
    console.error("Engineering Memory failed:", error.message);
  }
  const durationMs = Date.now() - startedAt;
  const endTime = new Date().toISOString();
  return { name: MEMORY_STAGE.name, script: MEMORY_STAGE.script, status, exitCode: null, startTime, endTime, durationMs, stdout, stderr, engineeringMemory };
}

/**
 * Runs every stage in order -- the once-only upfront stages, the Implementation Executor/Validation Engine/
 * Reflection Engine loop (up to the configured maximum iterations), and the once-only publish stages --
 * stopping immediately (recording every remaining stage as SKIPPED) the moment an upfront or publish stage
 * fails, or the loop concludes without an approved validation. This is the single entry point both the CLI
 * and any other caller (e.g. tests) should use for the actual orchestration logic.
 * @param {{spawnFn?: Function, cwd?: string, env?: object, nodeBin?: string, onStageEvent?: Function, maxIterations?: number, readIterationOutcome?: Function}} [deps]
 *   onStageEvent, if supplied, is called with {phase: "start"|"end"|"skip", stage, result?, iteration?} for
 *   progress reporting -- purely a side effect hook, never required for correctness.
 * @returns {{startTime: string, finishTime: string, durationMs: number, status: string, stages: object[], iterations: object[], maxIterations: number, iterationsUsed: number}}
 */
function runOrchestration(deps) {
  const startTime = new Date().toISOString();
  const startedAt = Date.now();
  const upfrontResults = [];
  const stages = [];
  const iterations = [];
  let stopped = false;
  let approved = false;

  for (const stage of UPFRONT_STAGES_BEFORE_HISTORICAL_CONTEXT) {
    if (stopped) {
      stages.push(skipStage(stage, deps));
      continue;
    }
    const result = runOne(stage, deps);
    stages.push(result);
    upfrontResults.push(result);
    if (result.status !== "PASS") stopped = true;
  }

  // Historical Context Retriever: skipped like any other upfront stage if an earlier stage already stopped
  // the run (its own input, repository-analysis.json, may not even be fresh at that point), but its own
  // failure -- unlike a normal upfront stage's -- is logged and never stops the run itself (see
  // runHistoricalContextStage()'s explicit non-blocking contract).
  let historicalContextResult;
  if (stopped) {
    historicalContextResult = skipStage(HISTORICAL_CONTEXT_STAGE, deps);
  } else {
    if (deps && deps.onStageEvent) deps.onStageEvent({ phase: "start", stage: HISTORICAL_CONTEXT_STAGE });
    historicalContextResult = runHistoricalContextStage(deps);
    if (deps && deps.onStageEvent) deps.onStageEvent({ phase: "end", stage: HISTORICAL_CONTEXT_STAGE, result: historicalContextResult });
  }
  stages.push(historicalContextResult);
  upfrontResults.push(historicalContextResult);

  for (const stage of UPFRONT_STAGES_AFTER_HISTORICAL_CONTEXT) {
    if (stopped) {
      stages.push(skipStage(stage, deps));
      continue;
    }
    const result = runOne(stage, deps);
    stages.push(result);
    upfrontResults.push(result);
    if (result.status !== "PASS") stopped = true;
  }

  const maxIter = resolveMaxIterations(deps);
  const readIterationOutcome = resolveReadIterationOutcome(deps);
  let iterationsUsed = 0;
  let lastOutcome = { approvedForPR: false, retryRecommended: false, validationScore: null };

  if (!stopped) {
    for (let iteration = 1; iteration <= maxIter; iteration += 1) {
      iterationsUsed = iteration;
      const iterationStages = LOOP_STAGES.map((stage) => runOne(stage, deps, iteration));
      iterations.push({ iteration, stages: iterationStages });

      const reflectionResult = iterationStages[iterationStages.length - 1];
      const infraFailure = reflectionResult.status !== "PASS";
      const outcome = infraFailure ? { approvedForPR: false, retryRecommended: false, validationScore: null } : readIterationOutcome(deps);
      lastOutcome = outcome;

      if (outcome.approvedForPR) {
        approved = true;
        break;
      }
      if (infraFailure || !outcome.retryRecommended || iteration >= maxIter) {
        break;
      }
      // else: another iteration is recommended and allowed -- loop again.
    }

    const finalIterationStages = iterations.length > 0 ? iterations[iterations.length - 1].stages : LOOP_STAGES.map((stage) => skipStage(stage, deps));
    stages.push(...finalIterationStages);
    if (!approved) stopped = true;
  } else {
    LOOP_STAGES.forEach((stage) => stages.push(skipStage(stage, deps)));
  }

  // Run History Manager: unconditional, regardless of `stopped`/`approved` -- "every autonomous execution
  // should leave behind a complete historical snapshot," including a failed one. Never affects `stopped`.
  const retryCount = Math.max(0, iterationsUsed - 1);
  const historySourceDir = (deps && deps.cwd) || root;
  if (deps && deps.onStageEvent) deps.onStageEvent({ phase: "start", stage: HISTORY_STAGE });
  const historyResult = runHistoryStage(deps, {
    runsDir: deps && deps.runsHistoryDir,
    sourceDir: historySourceDir,
    status: approved ? "SUCCESS" : "FAILED",
    startedAt: startTime,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    goal: process.env.GVAMS_GOAL || null,
    provider: process.env.EXECUTION_PROVIDER || null,
    profile: process.env.GVAMS_PROFILE || null,
    iterations: iterationsUsed,
    retryCount,
    validationPassed: lastOutcome.approvedForPR,
    validationScore: lastOutcome.validationScore,
    reflectionRetryRecommended: lastOutcome.retryRecommended,
    stageResults: [...upfrontResults, ...iterations.flatMap((it) => it.stages)],
    stdoutEntries: [...upfrontResults, ...iterations.flatMap((it) => it.stages)].map((stage) => ({ stage: stage.name, text: stage.stdout })),
    stderrEntries: [...upfrontResults, ...iterations.flatMap((it) => it.stages)].map((stage) => ({ stage: stage.name, text: stage.stderr })),
  });
  if (deps && deps.onStageEvent) deps.onStageEvent({ phase: "end", stage: HISTORY_STAGE, result: historyResult });
  stages.push(historyResult);

  // Engineering Memory: also unconditional, also never affects `stopped` -- deterministic analysis over
  // whatever runs/ now contains (including the run Run History Manager just archived above).
  if (deps && deps.onStageEvent) deps.onStageEvent({ phase: "start", stage: MEMORY_STAGE });
  const memoryResult = runMemoryStage({ ...deps, memoryRunsDir: (deps && deps.memoryRunsDir) || (deps && deps.runsHistoryDir) });
  if (deps && deps.onStageEvent) deps.onStageEvent({ phase: "end", stage: MEMORY_STAGE, result: memoryResult });
  stages.push(memoryResult);

  for (const stage of FINAL_STAGES) {
    if (!approved || stopped) {
      stages.push(skipStage(stage, deps));
      continue;
    }
    const result = runOne(stage, deps);
    stages.push(result);
    if (result.status !== "PASS") stopped = true;
  }

  const finishTime = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  const status = stages.every((stage) => stage.status === "PASS" || stage.status === "WARN") ? "success" : "failed";
  return {
    startTime,
    finishTime,
    durationMs,
    status,
    stages,
    iterations,
    maxIterations: maxIter,
    iterationsUsed,
    historicalContext: historicalContextResult.historicalContext ?? null,
    runHistory: historyResult.runHistory,
    engineeringMemory: memoryResult.engineeringMemory,
  };
}

/**
 * Lists every known artifact that actually exists on disk after a run, relative to the repository root.
 * Existence-checked only -- never parsed, so a malformed leftover JSON file from a previous run is still
 * correctly reported as "produced" without this orchestrator ever needing to understand its contents.
 * @param {string} [baseDir] defaults to the repository root
 * @returns {string[]}
 */
function findArtifactsProduced(baseDir) {
  const base = baseDir || root;
  return KNOWN_ARTIFACTS.filter((relativePath) => fs.existsSync(path.join(base, ...relativePath.split("/"))));
}

/**
 * Derives a run id from the run's own start time -- unique per run, with no separate clock read of its own.
 * @param {string} startTime ISO timestamp
 * @returns {string}
 */
function buildRunId(startTime) {
  return `RUN-${startTime.replace(/[^0-9A-Za-z]/g, "")}`;
}

/**
 * Builds the complete run record from an already-computed orchestration result.
 * @param {{startTime: string, finishTime: string, durationMs: number, status: string, stages: object[], iterations: object[], maxIterations: number, iterationsUsed: number, runHistory: (object|null), engineeringMemory: (object|null)}} orchestrationResult
 * @param {string} [baseDir] defaults to the repository root; used by tests running against a temp fixture
 * @returns {object} matching run.json's shape
 */
function buildRunRecord(orchestrationResult, baseDir) {
  return {
    runId: buildRunId(orchestrationResult.startTime),
    startTime: orchestrationResult.startTime,
    finishTime: orchestrationResult.finishTime,
    durationMs: orchestrationResult.durationMs,
    status: orchestrationResult.status,
    stages: orchestrationResult.stages,
    maxIterations: orchestrationResult.maxIterations,
    iterationsUsed: orchestrationResult.iterationsUsed,
    iterations: orchestrationResult.iterations,
    historicalContext: orchestrationResult.historicalContext,
    runHistory: orchestrationResult.runHistory,
    engineeringMemory: orchestrationResult.engineeringMemory,
    artifactsProduced: findArtifactsProduced(baseDir),
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------------------------------------------

/**
 * Renders the human-readable Markdown report for a given run record.
 * @param {object} run result of buildRunRecord()
 * @returns {string}
 */
function renderMarkdown(run) {
  const lines = [];
  lines.push("# Autonomous Engineering Orchestrator Report", "");
  lines.push(
    "Generated by `scripts/autonomous-orchestrator.js` -- this is the conductor, not another pipeline engine. It only runs the existing stages in order (looping Implementation Executor/Validation Engine/Reflection Engine up to the configured maximum iterations) and records what each one's own output reported; it never re-implements or re-decides anything any stage already owns.",
    ""
  );
  lines.push(`Run ID: \`${run.runId}\``, "");
  lines.push(`Timestamp: ${run.timestamp}`, "");

  lines.push("## Status", "");
  lines.push(`**${run.status}**`, "");

  lines.push("## Timing", "");
  lines.push(`- Start: ${run.startTime}`);
  lines.push(`- Finish: ${run.finishTime}`);
  lines.push(`- Duration: ${run.durationMs}ms`);
  lines.push("");

  lines.push("## Stages", "");
  lines.push("| # | Stage | Status | Exit Code | Duration |", "| ---: | --- | :---: | ---: | ---: |");
  run.stages.forEach((stage, index) => {
    lines.push(`| ${index + 1} | ${stage.name} | ${stage.status} | ${stage.exitCode === null ? "-" : stage.exitCode} | ${stage.durationMs === null ? "-" : `${stage.durationMs}ms`} |`);
  });
  lines.push("");

  lines.push("## Iterations", "");
  lines.push(`- Max iterations: ${run.maxIterations}`);
  lines.push(`- Iterations used: ${run.iterationsUsed}`);
  lines.push("");
  if (run.iterations.length > 1) {
    lines.push("| Iteration | Implementation Executor | Validation Engine | Reflection Engine |", "| ---: | :---: | :---: | :---: |");
    run.iterations.forEach((it) => {
      const [ie, ve, re] = it.stages;
      lines.push(`| ${it.iteration} | ${ie.status} | ${ve.status} | ${re.status} |`);
    });
    lines.push("");
  }

  const failed = run.stages.find((stage) => stage.status === "FAIL");
  if (failed) {
    lines.push("## Failure Detail", "");
    lines.push(`Stage **${failed.name}** (\`${failed.script}\`) exited with code ${failed.exitCode === null ? "unknown" : failed.exitCode}.`, "");
    if (failed.stderr) {
      lines.push("```", failed.stderr, "```", "");
    }
  }

  lines.push("## Historical Context", "");
  lines.push(
    run.historicalContext
      ? `Query "${run.historicalContext.query}" -- ${run.historicalContext.matchingRuns} matching run(s) (confidence ${run.historicalContext.confidence}).`
      : "Historical Context failed; no context was retrieved for this run.",
    ""
  );

  lines.push("## Run History", "");
  lines.push(
    run.runHistory ? `Archived to \`${path.relative(root, run.runHistory.runDir)}\` (run id \`${run.runHistory.runId}\`, ${run.runHistory.archivedFiles.length} artifact(s)).` : "History generation failed; no archive was created for this run.",
    ""
  );

  lines.push("## Engineering Memory", "");
  lines.push(
    run.engineeringMemory
      ? `Analyzed ${run.engineeringMemory.runsAnalyzed} run(s); wrote \`${path.relative(root, run.engineeringMemory.jsonPath)}\`.`
      : "Engineering Memory failed; no analysis was produced for this run.",
    ""
  );

  lines.push("## Artifacts Produced", "");
  (run.artifactsProduced.length ? run.artifactsProduced : ["None"]).forEach((artifact) => lines.push(`- \`${artifact}\``));
  lines.push("");

  lines.push("## Next Step", "");
  lines.push(
    run.status === "success"
      ? "Every stage completed successfully. Review `publish/publish.md` for the outcome (a dry run by default -- see GitHub Publisher Adapter's own documentation to publish for real)."
      : "Review the failed stage's details above (and its own report under its output directory, or `reflection/reflection-report.md` if a retry was or was not recommended), resolve the underlying issue, and re-run this orchestrator.",
    ""
  );

  return lines.join("\n");
}

/**
 * Writes run.json and run.md into the output directory (created if needed), returning their absolute paths.
 * @param {object} run
 * @returns {{jsonPath: string, mdPath: string}}
 */
function writeOutputs(run) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "run.json");
  const mdPath = path.join(outputDir, "run.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(run, null, 2)}\n`);
  fs.writeFileSync(mdPath, `${renderMarkdown(run)}\n`);
  return { jsonPath, mdPath };
}

/**
 * Prints clean, incremental console progress for a live run. A pure side effect -- never required for
 * correctness, and never used by runOrchestration() unless the caller opts in via deps.onStageEvent.
 * @param {{phase: string, stage: {name: string, script: string}, result?: object, iteration?: number}} event
 */
function printProgress(event) {
  const index = STAGES.findIndex((stage) => stage.script === event.stage.script) + 1;
  const total = STAGES.length;
  const suffix = event.iteration && event.iteration > 1 ? ` (iteration ${event.iteration})` : "";
  if (event.phase === "start") {
    process.stdout.write(`[${index}/${total}] ${event.stage.name}${suffix}... `);
  } else if (event.phase === "end") {
    const { status, exitCode, durationMs } = event.result;
    console.log(`${status}${exitCode !== null ? ` (exit ${exitCode})` : ""} - ${durationMs}ms`);
  } else if (event.phase === "skip") {
    console.log(`[${index}/${total}] ${event.stage.name}${suffix}... SKIPPED`);
  }
}

function main() {
  console.log(`Autonomous Engineering Orchestrator v1 -- running up to ${maxIterations} iteration(s) of the implementation loop.\n`);
  const orchestrationResult = runOrchestration({ onStageEvent: printProgress });
  const run = buildRunRecord(orchestrationResult);
  const { jsonPath, mdPath } = writeOutputs(run);
  console.log(`\nWrote ${path.relative(root, jsonPath)}`);
  console.log(`Wrote ${path.relative(root, mdPath)}`);
  console.log(`\nRun ${run.status === "success" ? "SUCCEEDED" : "FAILED"} in ${run.durationMs}ms (${run.iterationsUsed} iteration(s) used).`);
  if (run.status !== "success") process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  root,
  outputDir,
  maxIterations,
  DEFAULT_MAX_ITERATIONS,
  UPFRONT_STAGES,
  UPFRONT_STAGES_BEFORE_HISTORICAL_CONTEXT,
  UPFRONT_STAGES_AFTER_HISTORICAL_CONTEXT,
  LOOP_STAGES,
  HISTORY_STAGE,
  MEMORY_STAGE,
  HISTORICAL_CONTEXT_STAGE,
  FINAL_STAGES,
  STAGES,
  KNOWN_ARTIFACTS,
  runStage,
  runHistoryStage,
  runMemoryStage,
  runHistoricalContextStage,
  runOrchestration,
  defaultReadIterationOutcome,
  findArtifactsProduced,
  buildRunId,
  buildRunRecord,
  renderMarkdown,
  writeOutputs,
  printProgress,
};
