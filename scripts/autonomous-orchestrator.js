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

const UPFRONT_STAGES = [
  { name: "Repository Intelligence", script: "repository-intelligence.js" },
  { name: "Engineering Knowledge", script: "engineering-knowledge.js" },
  { name: "Recommendation Engine", script: "recommendation-engine.js" },
  { name: "Decision Engine", script: "decision-engine.js" },
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

// Flat view of every stage this orchestrator can run, in their natural single-pass order. Iteration 2+ of
// the loop is captured separately in run.json's `iterations` field (see runOrchestration()) -- this flat
// list always reflects the upfront stages plus the FINAL (decisive) loop attempt plus the publish stages.
const STAGES = [...UPFRONT_STAGES, ...LOOP_STAGES, ...FINAL_STAGES];

// Every artifact any stage might produce, relative to the repository root. Existence-checked only -- this
// orchestrator never opens or parses any of these; validating their content is each producing engine's own
// job, not this conductor's.
const KNOWN_ARTIFACTS = [
  "repository-intelligence/repository-analysis.json",
  "repository-intelligence/repository-analysis.md",
  "engineering-knowledge/engineering-knowledge.json",
  "engineering-knowledge/engineering-knowledge.md",
  "recommendations/recommendations.json",
  "recommendations/recommendations.md",
  "decision/decision.json",
  "decision/decision.md",
  "implementation-request/implementation-request.json",
  "implementation-request/implementation-request.md",
  "execution/execution.json",
  "execution/execution.md",
  "execution/patch-summary.json",
  "validation/validation.json",
  "validation/validation.md",
  "reflection/reflection-report.json",
  "reflection/reflection-report.md",
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
 * Reads validation.json's approvedForPR and reflection-report.json's retryRecommended off disk after one
 * iteration of the loop trio has run -- the two structured signals loop continuation is decided from.
 * Missing or unparseable files (e.g. because Reflection Engine itself failed to run) are treated as "not
 * approved, do not retry" -- never guessed at.
 * @param {{cwd?: string}} [deps]
 * @returns {{approvedForPR: boolean, retryRecommended: boolean}}
 */
function defaultReadIterationOutcome(deps) {
  const cwd = (deps && deps.cwd) || root;
  let approvedForPR = false;
  let retryRecommended = false;
  try {
    const validation = JSON.parse(fs.readFileSync(path.join(cwd, "validation", "validation.json"), "utf8"));
    approvedForPR = validation.approvedForPR === true;
  } catch (error) {
    approvedForPR = false;
  }
  try {
    const reflection = JSON.parse(fs.readFileSync(path.join(cwd, "reflection", "reflection-report.json"), "utf8"));
    retryRecommended = reflection.retryRecommended === true;
  } catch (error) {
    retryRecommended = false;
  }
  return { approvedForPR, retryRecommended };
}

function resolveReadIterationOutcome(deps) {
  return (deps && deps.readIterationOutcome) || defaultReadIterationOutcome;
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
  const stages = [];
  const iterations = [];
  let stopped = false;
  let approved = false;

  for (const stage of UPFRONT_STAGES) {
    if (stopped) {
      stages.push(skipStage(stage, deps));
      continue;
    }
    const result = runOne(stage, deps);
    stages.push(result);
    if (result.status !== "PASS") stopped = true;
  }

  const maxIter = resolveMaxIterations(deps);
  const readIterationOutcome = resolveReadIterationOutcome(deps);
  let iterationsUsed = 0;

  if (!stopped) {
    for (let iteration = 1; iteration <= maxIter; iteration += 1) {
      iterationsUsed = iteration;
      const iterationStages = LOOP_STAGES.map((stage) => runOne(stage, deps, iteration));
      iterations.push({ iteration, stages: iterationStages });

      const reflectionResult = iterationStages[iterationStages.length - 1];
      const infraFailure = reflectionResult.status !== "PASS";
      const outcome = infraFailure ? { approvedForPR: false, retryRecommended: false } : readIterationOutcome(deps);

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
  const status = stages.every((stage) => stage.status === "PASS") ? "success" : "failed";
  return { startTime, finishTime, durationMs, status, stages, iterations, maxIterations: maxIter, iterationsUsed };
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
 * @param {{startTime: string, finishTime: string, durationMs: number, status: string, stages: object[], iterations: object[], maxIterations: number, iterationsUsed: number}} orchestrationResult
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
  LOOP_STAGES,
  FINAL_STAGES,
  STAGES,
  KNOWN_ARTIFACTS,
  runStage,
  runOrchestration,
  defaultReadIterationOutcome,
  findArtifactsProduced,
  buildRunId,
  buildRunRecord,
  renderMarkdown,
  writeOutputs,
  printProgress,
};
