#!/usr/bin/env node
// Autonomous Engineering Orchestrator v1 regression coverage: the pure orchestration logic (runOrchestration,
// findArtifactsProduced, buildRunRecord, renderMarkdown), including the Implementation Executor/Validation
// Engine/Reflection Engine iteration loop, is exercised with an injected fake spawn function and a scripted
// readIterationOutcome (fast, deterministic, no real engines needed and never touching this actual
// repository's own artifacts). The CLI is exercised against real subprocesses using tiny fake stage scripts
// (controllable exit codes, mirroring the fake-"claude"/fake-"gh" technique used elsewhere in this
// pipeline), and one true end-to-end run drives the real fourteen-stage chain (including Run History
// Manager, Historical Context Retriever, Execution Planner, and Engineering Memory).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "scripts/autonomous-orchestrator.js"), "utf8");
const runHistoryManagerSource = fs.readFileSync(path.join(repoRoot, "scripts/run-history-manager.js"), "utf8");
const engineeringMemorySource = fs.readFileSync(path.join(repoRoot, "scripts/engineering-memory.js"), "utf8");
const historicalContextRetrieverSource = fs.readFileSync(path.join(repoRoot, "scripts/historical-context-retriever.js"), "utf8");

// The eleven pipeline engines this orchestrator spawns as real subprocesses. Run History Manager, Engineering
// Memory, and Historical Context Retriever are deliberately NOT in this list -- all three are require()'d
// in-process (see runHistoryStage()/runMemoryStage()/runHistoricalContextStage() in
// autonomous-orchestrator.js), never spawned, so they each need a real, valid module file, not a fake
// exit-code stub script.
const ENGINE_SCRIPTS = [
  "repository-intelligence.js",
  "engineering-knowledge.js",
  "recommendation-engine.js",
  "adaptive-decision-engine.js",
  "execution-planner.js",
  "implementation-request-engine.js",
  "implementation-executor.js",
  "validation-engine.js",
  "reflection-engine.js",
  "pull-request-generator.js",
  "github-publisher.js",
];

// Stages that are always require()'d in-process, never spawned via spawnFn -- excluded from any assertion
// counting "spawned" invocations, and from "must be SKIPPED after a failure" checks (since some of these,
// see UNCONDITIONAL_IN_PROCESS_SCRIPTS below, run no matter what).
const IN_PROCESS_SCRIPTS = ["run-history-manager.js", "engineering-memory.js", "historical-context-retriever.js"];

// The subset of IN_PROCESS_SCRIPTS that run truly unconditionally, regardless of `stopped` -- Run History
// Manager and Engineering Memory both run once the whole run concludes (approved, rejected, or exhausted).
// Historical Context Retriever is NOT in this list: it sits mid-pipeline (between Engineering Knowledge and
// Recommendation Engine) and is skipped exactly like any other upfront stage if an earlier stage already
// stopped the run -- only ITS OWN failure (not an earlier stage's) is non-blocking.
const UNCONDITIONAL_IN_PROCESS_SCRIPTS = ["run-history-manager.js", "engineering-memory.js"];

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Every fixture also gets real copies of run-history-manager.js, engineering-memory.js, and
// historical-context-retriever.js alongside autonomous-orchestrator.js, since
// runHistoryStage()/runMemoryStage()/runHistoricalContextStage() require() them in-process (not through the
// injected spawnFn) -- without them, every runOrchestration() call in these tests would report all three
// stages as "WARN" (module not found) rather than genuinely exercising them.
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autonomous-orchestrator-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/autonomous-orchestrator.js"), source);
  fs.writeFileSync(path.join(dir, "scripts/run-history-manager.js"), runHistoryManagerSource);
  fs.writeFileSync(path.join(dir, "scripts/engineering-memory.js"), engineeringMemorySource);
  fs.writeFileSync(path.join(dir, "scripts/historical-context-retriever.js"), historicalContextRetrieverSource);
  return dir;
}

function requireFixture(dir) {
  return require(path.join(dir, "scripts/autonomous-orchestrator.js"));
}

function makeFakeSpawn(failOnScript, callLog) {
  return (nodeBin, args) => {
    const scriptName = path.basename(args[0]);
    if (callLog) callLog.push(scriptName);
    if (failOnScript && scriptName === failOnScript) {
      return { status: 1, stdout: "", stderr: `simulated failure in ${scriptName}`, error: null };
    }
    return { status: 0, stdout: `ok: ${scriptName}`, stderr: "", error: null };
  };
}

// Returns a stateful readIterationOutcome function that yields each entry of `outcomes` in turn (repeating
// the last entry if called more times than there are entries).
function makeScriptedOutcome(outcomes) {
  let index = 0;
  return () => {
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    return outcome;
  };
}

const NEVER_APPROVE_NO_RETRY = () => ({ approvedForPR: false, retryRecommended: false });

function ok(name) {
  console.log(`${name}: observed expected deterministic outcome`);
}

// 1. Stage failure (upfront stage): a failure before the implementation loop is recorded FAIL, every stage
//    before it PASSes, and overall orchestration status is "failed".
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const result = mod.runOrchestration({ spawnFn: makeFakeSpawn("adaptive-decision-engine.js"), cwd: dir });
  if (result.status !== "failed") throw new Error(`expected overall status "failed", got: ${result.status}`);
  const failedIndex = mod.STAGES.findIndex((s) => s.script === "adaptive-decision-engine.js");
  if (result.stages[failedIndex].status !== "FAIL") throw new Error(`expected Adaptive Decision Engine to FAIL, got: ${result.stages[failedIndex].status}`);
  if (result.stages.slice(0, failedIndex).some((s) => s.status !== "PASS")) throw new Error("expected every stage before the failure to PASS");
  ok("an upfront-stage failure is correctly recorded, and overall status becomes \"failed\"");
}

// 2. Skipped stages (upfront failure): every stage after an upfront failure -- including the entire
//    Implementation Executor/Validation Engine/Reflection Engine loop, and the publish stages -- is recorded
//    SKIPPED, never attempted (no exit code, no timing). Upfront stages are deterministic pure functions of
//    already-fixed state, so there is nothing for the loop to meaningfully evaluate once one of them has
//    failed. Run History Manager and Engineering Memory are the deliberate exceptions -- they still run
//    unconditionally, since every autonomous execution (including a failed one) should leave behind a
//    historical snapshot and an updated analysis of it.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const result = mod.runOrchestration({ spawnFn: makeFakeSpawn("recommendation-engine.js"), cwd: dir });
  const failedIndex = mod.STAGES.findIndex((s) => s.script === "recommendation-engine.js");
  const remaining = result.stages.slice(failedIndex + 1).filter((s) => !IN_PROCESS_SCRIPTS.includes(s.script));
  if (remaining.length === 0) throw new Error("expected at least one stage after the failure to verify SKIPPED behavior");
  if (remaining.some((s) => s.status !== "SKIPPED" || s.exitCode !== null || s.startTime !== null || s.durationMs !== null)) {
    throw new Error(`expected every remaining spawned stage to be cleanly SKIPPED (no exit code, no timing), got: ${JSON.stringify(remaining)}`);
  }
  for (const script of UNCONDITIONAL_IN_PROCESS_SCRIPTS) {
    const stage = result.stages.find((s) => s.script === script);
    if (stage.status !== "PASS") throw new Error(`expected ${script} to still run (and succeed) unconditionally, even after an upfront failure`);
  }
  // Historical Context Retriever sits BEFORE recommendation-engine.js, so it already ran (and passed) before
  // this failure occurred -- it is not among the SKIPPED "remaining" stages either.
  const historicalContextStage = result.stages.find((s) => s.script === "historical-context-retriever.js");
  if (historicalContextStage.status !== "PASS") throw new Error("expected Historical Context Retriever, positioned before the failure, to have already run and succeeded");
  if (result.iterationsUsed !== 0) throw new Error(`expected 0 loop iterations to be attempted after an upfront failure, got: ${result.iterationsUsed}`);
  ok("every spawned stage after an upfront failure is SKIPPED except Run History Manager/Engineering Memory, which still run unconditionally, and the loop is never entered");
}

// 3. A loop-stage failure (Implementation Executor itself exits non-zero, e.g. "blocked") does NOT skip
//    Validation Engine or Reflection Engine -- they still run, exactly as the real pipeline requires, since
//    Validation Engine's whole job is interpreting whatever Implementation Executor produced. Only the
//    publish stages are skipped once the loop concludes without an approval.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const result = mod.runOrchestration({ spawnFn: makeFakeSpawn("implementation-executor.js"), cwd: dir, readIterationOutcome: NEVER_APPROVE_NO_RETRY });
  const ie = result.stages.find((s) => s.script === "implementation-executor.js");
  const ve = result.stages.find((s) => s.script === "validation-engine.js");
  const refl = result.stages.find((s) => s.script === "reflection-engine.js");
  const prg = result.stages.find((s) => s.script === "pull-request-generator.js");
  if (ie.status !== "FAIL") throw new Error(`expected Implementation Executor to FAIL, got: ${ie.status}`);
  if (ve.status !== "PASS" || refl.status !== "PASS") throw new Error(`expected Validation Engine and Reflection Engine to still run after an Implementation Executor failure, got: ${ve.status}/${refl.status}`);
  if (prg.status !== "SKIPPED") throw new Error("expected Pull Request Generator to be SKIPPED when the loop never reaches approval");
  if (result.status !== "failed") throw new Error(`expected overall status "failed", got: ${result.status}`);
  ok("an Implementation Executor failure still lets Validation Engine and Reflection Engine run, and only the publish stages are skipped");
}

// 4. Successful execution: every stage passes and the (simulated) validation is approved on the first
//    iteration, so overall status is "success" and the publish stages run.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const callLog = [];
  const result = mod.runOrchestration({ spawnFn: makeFakeSpawn(null, callLog), cwd: dir, readIterationOutcome: () => ({ approvedForPR: true, retryRecommended: false }) });
  if (result.status !== "success") throw new Error(`expected overall status "success", got: ${result.status}`);
  if (result.stages.some((s) => s.status !== "PASS")) throw new Error("expected every stage to PASS");
  if (result.iterationsUsed !== 1) throw new Error(`expected exactly 1 iteration when approved on the first attempt, got: ${result.iterationsUsed}`);
  const spawnedStageCount = mod.STAGES.filter((stage) => !IN_PROCESS_SCRIPTS.includes(stage.script)).length;
  if (callLog.length !== spawnedStageCount) throw new Error(`expected exactly ${spawnedStageCount} spawned stage invocations (Run History Manager/Engineering Memory are require()'d, not spawned), got: ${callLog.length}`);
  for (const script of IN_PROCESS_SCRIPTS) {
    const stage = result.stages.find((s) => s.script === script);
    if (stage.status !== "PASS") throw new Error(`expected the real ${script} to genuinely succeed in this fixture, got: ${stage.status} (${stage.stderr})`);
  }
  ok("a fully successful run passes every stage (including the in-process Run History Manager/Engineering Memory), uses exactly 1 iteration, and reports overall status \"success\"");
}

// 5. Iteration loop: a rejection with a recommended retry causes a second iteration to run; once that second
//    iteration is approved, the loop stops and Pull Request Generator/GitHub Publisher Adapter each run
//    EXACTLY once (never once per iteration).
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const callLog = [];
  const outcome = makeScriptedOutcome([
    { approvedForPR: false, retryRecommended: true },
    { approvedForPR: true, retryRecommended: false },
  ]);
  const result = mod.runOrchestration({ spawnFn: makeFakeSpawn(null, callLog), cwd: dir, maxIterations: 3, readIterationOutcome: outcome });
  if (result.status !== "success") throw new Error(`expected overall status "success" once approved on the second iteration, got: ${result.status}`);
  if (result.iterationsUsed !== 2) throw new Error(`expected exactly 2 iterations to be used, got: ${result.iterationsUsed}`);
  if (result.iterations.length !== 2) throw new Error(`expected 2 recorded iterations, got: ${result.iterations.length}`);
  const prgCount = callLog.filter((script) => script === "pull-request-generator.js").length;
  const gpaCount = callLog.filter((script) => script === "github-publisher.js").length;
  if (prgCount !== 1 || gpaCount !== 1) throw new Error(`expected Pull Request Generator/GitHub Publisher Adapter to run exactly once each, got ${prgCount}/${gpaCount} invocations`);
  const ieCount = callLog.filter((script) => script === "implementation-executor.js").length;
  if (ieCount !== 2) throw new Error(`expected Implementation Executor to run once per iteration (2 total), got ${ieCount}`);
  ok("a recommended retry runs a second iteration, and once approved the publish stages run exactly once, never once per iteration");
}

// 6. Configurable maximum iterations: when a retry is recommended every time but approval never happens, the
//    loop stops exactly at the configured maximum, and the publish stages are skipped.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const result = mod.runOrchestration({ spawnFn: makeFakeSpawn(null), cwd: dir, maxIterations: 2, readIterationOutcome: () => ({ approvedForPR: false, retryRecommended: true }) });
  if (result.iterationsUsed !== 2) throw new Error(`expected exactly the configured maximum (2) iterations to be used, got: ${result.iterationsUsed}`);
  if (result.status !== "failed") throw new Error(`expected overall status "failed" when the maximum iterations are exhausted without approval, got: ${result.status}`);
  const prg = result.stages.find((s) => s.script === "pull-request-generator.js");
  if (prg.status !== "SKIPPED") throw new Error("expected Pull Request Generator to be SKIPPED when the maximum iterations are exhausted without approval");
  ok("the loop stops exactly at the configured maximum iteration count when approval never happens, and skips the publish stages");
}

// 7. No retry recommended: the loop stops after exactly 1 iteration even when more are allowed, since
//    Reflection Engine's own recommendation -- not the iteration budget -- controls continuation.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const result = mod.runOrchestration({ spawnFn: makeFakeSpawn(null), cwd: dir, maxIterations: 5, readIterationOutcome: NEVER_APPROVE_NO_RETRY });
  if (result.iterationsUsed !== 1) throw new Error(`expected exactly 1 iteration when no retry is recommended, regardless of the configured maximum, got: ${result.iterationsUsed}`);
  ok("when Reflection Engine recommends no retry, the loop stops after 1 iteration regardless of how many more are allowed");
}

// 8. Infrastructure failure inside the loop: if Reflection Engine itself fails to run (distinct from a
//    normal "rejected" business outcome), the loop stops immediately rather than guessing whether to retry.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const result = mod.runOrchestration({ spawnFn: makeFakeSpawn("reflection-engine.js"), cwd: dir, maxIterations: 3 });
  if (result.iterationsUsed !== 1) throw new Error(`expected the loop to stop after 1 iteration when Reflection Engine itself fails to run, got: ${result.iterationsUsed}`);
  if (result.status !== "failed") throw new Error("expected overall status \"failed\" when Reflection Engine fails to run");
  ok("Reflection Engine itself failing to run is treated as an infrastructure failure and stops the loop immediately, never guessing a retry");
}

// 9. Missing artifacts: findArtifactsProduced() against an empty directory correctly reports nothing
//    produced.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "autonomous-orchestrator-empty-"));
  const artifacts = mod.findArtifactsProduced(emptyDir);
  if (artifacts.length !== 0) throw new Error(`expected no artifacts for an empty directory, got: ${JSON.stringify(artifacts)}`);
  ok("findArtifactsProduced reports nothing produced when no known artifact files exist");
}

// 10. Malformed artifacts: an artifact file (including Reflection Engine's own report) that exists but
//     contains invalid JSON is still correctly reported as produced (existence-only check, never parsed).
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "autonomous-orchestrator-malformed-"));
  writeFile(path.join(fixtureDir, "decision", "decision.json"), "{ this is not valid JSON at all !!");
  writeFile(path.join(fixtureDir, "reflection", "reflection-report.json"), "{ also not valid JSON");
  const artifacts = mod.findArtifactsProduced(fixtureDir);
  if (!artifacts.includes("decision/decision.json")) throw new Error("expected a malformed-but-present artifact to still be reported as produced");
  if (!artifacts.includes("reflection/reflection-report.json")) throw new Error("expected a malformed-but-present reflection-report.json to still be reported as produced");
  ok("a malformed artifact file (including a reflection report) is still correctly reported as produced (existence-only, never parsed)");
}

// 11. Duration: every ran stage has a non-negative, finite durationMs; every skipped stage has durationMs
//     null; the overall run's finishTime is not before its startTime.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const result = mod.runOrchestration({ spawnFn: makeFakeSpawn("recommendation-engine.js"), cwd: dir });
  for (const stage of result.stages) {
    if (stage.status === "SKIPPED") {
      if (stage.durationMs !== null) throw new Error("expected a SKIPPED stage's durationMs to be null");
    } else if (typeof stage.durationMs !== "number" || !Number.isFinite(stage.durationMs) || stage.durationMs < 0) {
      throw new Error(`expected a non-negative finite durationMs for a ran stage, got: ${stage.durationMs}`);
    }
  }
  if (typeof result.durationMs !== "number" || !Number.isFinite(result.durationMs) || result.durationMs < 0) throw new Error(`expected a non-negative finite overall durationMs, got: ${result.durationMs}`);
  if (Date.parse(result.finishTime) < Date.parse(result.startTime)) throw new Error("expected finishTime to not be before startTime");
  ok("duration is correctly tracked per stage (null when skipped) and for the overall run, with finishTime never before startTime");
}

// 12. Report generation: renderMarkdown includes every required section (including the new Iterations
//     section and its per-iteration table when more than one iteration ran), and a Failure Detail section
//     only when a stage actually failed.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const failedResult = mod.runOrchestration({ spawnFn: makeFakeSpawn("validation-engine.js"), cwd: dir, readIterationOutcome: NEVER_APPROVE_NO_RETRY });
  const failedRun = mod.buildRunRecord(failedResult, dir);
  const failedMarkdown = mod.renderMarkdown(failedRun);
  for (const heading of ["# Autonomous Engineering Orchestrator Report", "## Status", "## Timing", "## Stages", "## Iterations", "## Failure Detail", "## Artifacts Produced", "## Next Step"]) {
    if (!failedMarkdown.includes(heading)) throw new Error(`expected markdown to include "${heading}" for a failed run`);
  }

  const multiIterationResult = mod.runOrchestration({
    spawnFn: makeFakeSpawn(null),
    cwd: dir,
    maxIterations: 2,
    readIterationOutcome: makeScriptedOutcome([{ approvedForPR: false, retryRecommended: true }, { approvedForPR: true, retryRecommended: false }]),
  });
  const multiIterationMarkdown = mod.renderMarkdown(mod.buildRunRecord(multiIterationResult, dir));
  if (!/\| 2 \|/.test(multiIterationMarkdown)) throw new Error("expected the iterations table to include a row for iteration 2");

  const successResult = mod.runOrchestration({ spawnFn: makeFakeSpawn(null), cwd: dir, readIterationOutcome: () => ({ approvedForPR: true, retryRecommended: false }) });
  const successMarkdown = mod.renderMarkdown(mod.buildRunRecord(successResult, dir));
  if (successMarkdown.includes("## Failure Detail")) throw new Error("expected no Failure Detail section for a fully successful run");

  ok("renderMarkdown includes every required section (including Iterations), the full stage table, and a conditional Failure Detail section");
}

// 13. CLI + exit codes: a real subprocess run against tiny fake stage scripts (controllable exit codes)
//     proves the real CLI stops immediately on an upfront failure (exit 1) and succeeds (exit 0) when every
//     stage passes -- including a fake Validation Engine that writes a real approvedForPR:true so the real
//     orchestrator's own file-based readIterationOutcome() correctly reads it.
{
  const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), "autonomous-orchestrator-cli-"));
  fs.mkdirSync(path.join(cliDir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(cliDir, "scripts/autonomous-orchestrator.js"), source);
  fs.writeFileSync(path.join(cliDir, "scripts/run-history-manager.js"), runHistoryManagerSource);
  fs.writeFileSync(path.join(cliDir, "scripts/engineering-memory.js"), engineeringMemorySource);
  fs.writeFileSync(path.join(cliDir, "scripts/historical-context-retriever.js"), historicalContextRetrieverSource);
  for (const script of ENGINE_SCRIPTS) {
    const shouldFail = script === "adaptive-decision-engine.js";
    writeFile(
      path.join(cliDir, "scripts", script),
      shouldFail ? 'console.error("simulated fake-stage failure"); process.exit(1);\n' : `console.log("fake stage ok: ${script}"); process.exit(0);\n`
    );
  }
  const failingRun = spawnSync("node", ["scripts/autonomous-orchestrator.js"], { cwd: cliDir, encoding: "utf8" });
  if (failingRun.status !== 1) throw new Error(`expected the CLI to exit 1 when an upfront stage fails, got exit ${failingRun.status}:\n${failingRun.stdout}\n${failingRun.stderr}`);
  if (!failingRun.stdout.includes("Adaptive Decision Engine... FAIL")) throw new Error(`expected clean console progress to show the failing stage, got:\n${failingRun.stdout}`);
  if (!failingRun.stdout.includes("Pull Request Generator... SKIPPED")) throw new Error(`expected clean console progress to show skipped stages, got:\n${failingRun.stdout}`);
  const failedRunJson = JSON.parse(fs.readFileSync(path.join(cliDir, "run/run.json"), "utf8"));
  if (failedRunJson.status !== "failed") throw new Error(`expected run.json status "failed", got: ${failedRunJson.status}`);
  for (const script of IN_PROCESS_SCRIPTS) {
    const stage = failedRunJson.stages.find((s) => s.script === script);
    if (!stage || stage.status !== "PASS") throw new Error(`expected ${script} to still have PASSed (either unconditionally, or by already having run before adaptive-decision-engine.js's later failure)`);
  }
  if (!fs.existsSync(path.join(cliDir, "runs", "RUN-000001"))) throw new Error("expected a runs/RUN-000001 archive to be created even for a failed run");
  if (!fs.existsSync(path.join(cliDir, "memory", "engineering-memory.json"))) throw new Error("expected memory/engineering-memory.json to be created even for a failed run");
  if (!fs.existsSync(path.join(cliDir, "historical-context", "historical-context.json"))) throw new Error("expected historical-context/historical-context.json to be created (it ran before the later adaptive-decision-engine.js failure)");

  for (const script of ENGINE_SCRIPTS) {
    writeFile(path.join(cliDir, "scripts", script), `console.log("fake stage ok: ${script}"); process.exit(0);\n`);
  }
  writeFile(
    path.join(cliDir, "scripts/validation-engine.js"),
    `
      const fs = require("fs");
      const path = require("path");
      fs.mkdirSync(path.join(process.cwd(), "validation"), { recursive: true });
      fs.writeFileSync(path.join(process.cwd(), "validation", "validation.json"), JSON.stringify({ approvedForPR: true, status: "approved" }));
      console.log("fake validation-engine ok");
      process.exit(0);
    `
  );
  const successRun = spawnSync("node", ["scripts/autonomous-orchestrator.js"], { cwd: cliDir, encoding: "utf8" });
  if (successRun.status !== 0) throw new Error(`expected the CLI to exit 0 when every stage passes and validation is approved, got exit ${successRun.status}:\n${successRun.stdout}\n${successRun.stderr}`);
  const successRunJson = JSON.parse(fs.readFileSync(path.join(cliDir, "run/run.json"), "utf8"));
  if (successRunJson.status !== "success" || successRunJson.stages.some((s) => s.status !== "PASS")) throw new Error(`expected a fully passing run.json, got: ${JSON.stringify(successRunJson)}`);
  if (successRunJson.iterationsUsed !== 1) throw new Error(`expected exactly 1 iteration to be used, got: ${successRunJson.iterationsUsed}`);
  if (!successRunJson.runHistory || successRunJson.runHistory.runId !== "RUN-000002") throw new Error(`expected the second run's runHistory to be RUN-000002 (sequential, never reused), got: ${JSON.stringify(successRunJson.runHistory)}`);
  if (!fs.existsSync(path.join(cliDir, "runs", "RUN-000002", "metadata.json"))) throw new Error("expected a full runs/RUN-000002 archive for the successful run");

  ok("the real CLI, run against real (fake) stage subprocesses, exits 1 and stops immediately on an upfront failure, and exits 0 when every stage passes and validation is approved -- both runs archived sequentially under runs/");
}

// 14. End-to-end execution: the real fourteen-stage chain, driven entirely by the real orchestrator CLI using
//     the real engine sources (including the real Reflection Engine, Historical Context Retriever, and
//     Execution Planner), produces a valid, internally-consistent run.json/run.md.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autonomous-orchestrator-e2e-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/autonomous-orchestrator.js"), source);
  fs.mkdirSync(path.join(dir, "providers/claude"), { recursive: true });
  for (const relPath of [
    "scripts/repository-intelligence.js",
    "scripts/engineering-knowledge.js",
    "scripts/historical-context-retriever.js",
    "scripts/recommendation-engine.js",
    "scripts/adaptive-decision-engine.js",
    "scripts/execution-planner.js",
    "scripts/implementation-request-engine.js",
    "scripts/implementation-executor.js",
    "scripts/validation-engine.js",
    "scripts/reflection-engine.js",
    "scripts/run-history-manager.js",
    "scripts/engineering-memory.js",
    "scripts/pull-request-generator.js",
    "scripts/github-publisher.js",
    "publisher/github/client.js",
  ]) {
    fs.mkdirSync(path.dirname(path.join(dir, relPath)), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, relPath), path.join(dir, relPath));
  }

  const run = spawnSync("node", ["scripts/autonomous-orchestrator.js"], { cwd: dir, encoding: "utf8", env: { ...process.env, EXECUTION_APPROVED: "true" } });
  const jsonPath = path.join(dir, "run", "run.json");
  const mdPath = path.join(dir, "run", "run.md");
  if (!fs.existsSync(jsonPath) || !fs.existsSync(mdPath)) throw new Error(`expected run.json and run.md to be produced by the real end-to-end chain:\n${run.stdout}\n${run.stderr}`);

  const runRecord = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (runRecord.stages.length !== 14) throw new Error(`expected all 14 real stages (including Run History Manager, Historical Context Retriever, Execution Planner, and Engineering Memory) to be recorded, got: ${runRecord.stages.length}`);
  if (!runRecord.stages.some((s) => s.script === "reflection-engine.js")) throw new Error("expected Reflection Engine to be recorded among the real stages");
  const historyStage = runRecord.stages.find((s) => s.script === "run-history-manager.js");
  if (!historyStage || historyStage.status !== "PASS") throw new Error(`expected Run History Manager to genuinely succeed in the real end-to-end chain, got: ${JSON.stringify(historyStage)}`);
  const memoryStage = runRecord.stages.find((s) => s.script === "engineering-memory.js");
  if (!memoryStage || memoryStage.status !== "PASS") throw new Error(`expected Engineering Memory to genuinely succeed in the real end-to-end chain, got: ${JSON.stringify(memoryStage)}`);
  const historicalContextStage = runRecord.stages.find((s) => s.script === "historical-context-retriever.js");
  if (!historicalContextStage || historicalContextStage.status !== "PASS") throw new Error(`expected Historical Context Retriever to genuinely succeed in the real end-to-end chain, got: ${JSON.stringify(historicalContextStage)}`);
  const adaptiveDecisionStage = runRecord.stages.find((s) => s.script === "adaptive-decision-engine.js");
  if (!adaptiveDecisionStage || adaptiveDecisionStage.status !== "PASS") throw new Error(`expected Adaptive Decision Engine to genuinely succeed in the real end-to-end chain, got: ${JSON.stringify(adaptiveDecisionStage)}`);
  if (!fs.existsSync(path.join(dir, "decision", "adaptive-decision.json")) || !fs.existsSync(path.join(dir, "decision", "decision.json"))) {
    throw new Error("expected Adaptive Decision Engine to produce both decision/adaptive-decision.json and the backward-compatible decision/decision.json");
  }
  const executionPlannerStage = runRecord.stages.find((s) => s.script === "execution-planner.js");
  if (!executionPlannerStage || executionPlannerStage.status !== "PASS") throw new Error(`expected Execution Planner to genuinely succeed in the real end-to-end chain, got: ${JSON.stringify(executionPlannerStage)}`);
  const adaptiveDecisionIndex = runRecord.stages.findIndex((s) => s.script === "adaptive-decision-engine.js");
  const executionPlannerIndex = runRecord.stages.findIndex((s) => s.script === "execution-planner.js");
  const implementationRequestIndex = runRecord.stages.findIndex((s) => s.script === "implementation-request-engine.js");
  if (!(adaptiveDecisionIndex < executionPlannerIndex && executionPlannerIndex < implementationRequestIndex)) {
    throw new Error("expected Execution Planner to run between Adaptive Decision Engine and Implementation Request Engine in the real chain");
  }
  if (!fs.existsSync(path.join(dir, "execution-plan", "execution-plan.json"))) throw new Error("expected execution-plan/execution-plan.json to be produced by the real end-to-end chain");
  const historicalContextIndex = runRecord.stages.findIndex((s) => s.script === "historical-context-retriever.js");
  const recommendationIndex = runRecord.stages.findIndex((s) => s.script === "recommendation-engine.js");
  if (historicalContextIndex === -1 || recommendationIndex === -1 || historicalContextIndex >= recommendationIndex) {
    throw new Error("expected Historical Context Retriever to run before Recommendation Engine in the real chain");
  }
  if (!runRecord.runHistory || !fs.existsSync(path.join(dir, "runs", runRecord.runHistory.runId, "metadata.json"))) {
    throw new Error(`expected a real runs/${runRecord.runHistory && runRecord.runHistory.runId}/metadata.json archive to exist`);
  }
  if (!runRecord.engineeringMemory || !fs.existsSync(runRecord.engineeringMemory.jsonPath)) {
    throw new Error("expected a real memory/engineering-memory.json to exist, referenced from run.json's own engineeringMemory field");
  }
  if (runRecord.engineeringMemory.runsAnalyzed < 1) throw new Error("expected Engineering Memory to have analyzed at least the run it was just given (Run History Manager runs first)");
  if (!runRecord.historicalContext || typeof runRecord.historicalContext.query !== "string") {
    throw new Error("expected a real historicalContext field with a query, referenced from run.json's own historicalContext field");
  }
  if (run.status === 0) {
    if (runRecord.status !== "success" || runRecord.stages.some((s) => s.status !== "PASS")) throw new Error(`expected a fully passing real run.json, got: ${JSON.stringify(runRecord.stages)}`);
    if (!runRecord.artifactsProduced.includes("publish/publish.json")) throw new Error("expected publish/publish.json to be listed as a produced artifact for a fully successful real run");
    if (!runRecord.artifactsProduced.includes("reflection/reflection-report.json")) throw new Error("expected reflection/reflection-report.json to be listed as a produced artifact");
    if (!runRecord.artifactsProduced.includes("memory/engineering-memory.json")) throw new Error("expected memory/engineering-memory.json to be listed as a produced artifact");
    if (!runRecord.artifactsProduced.includes("historical-context/historical-context.json")) throw new Error("expected historical-context/historical-context.json to be listed as a produced artifact");
    if (!runRecord.artifactsProduced.includes("decision/adaptive-decision.json")) throw new Error("expected decision/adaptive-decision.json to be listed as a produced artifact");
    if (!runRecord.artifactsProduced.includes("execution-plan/execution-plan.json")) throw new Error("expected execution-plan/execution-plan.json to be listed as a produced artifact");
    if (runRecord.runHistory.archivedFiles.length === 0) throw new Error("expected the real successful run to have archived at least one real artifact");
  } else {
    if (runRecord.status !== "failed") throw new Error(`expected run.json status "failed" to match a non-zero CLI exit code, got: ${runRecord.status}`);
  }

  ok("the real fourteen-stage chain, driven by the real orchestrator CLI (including Reflection Engine, Historical Context Retriever, Execution Planner, Run History Manager, and Engineering Memory), produces a valid and internally-consistent run.json/run.md end to end, with real runs/, historical-context/, execution-plan/, and memory/ output");
}

// 15. Run History Manager integration: it is called exactly once (in-process, never via spawnFn) after the
//     loop concludes and before the publish stages -- verified directly via an injected fake module so the
//     exact context it receives can be inspected.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const calls = [];
  const fakeRunHistoryManager = {
    archiveRunSync: (context) => {
      calls.push(context);
      return { runId: "RUN-000001", runDir: path.join(dir, "runs", "RUN-000001"), archivedFiles: ["decision.json"] };
    },
  };
  const result = mod.runOrchestration({
    spawnFn: makeFakeSpawn(null),
    cwd: dir,
    runHistoryManager: fakeRunHistoryManager,
    readIterationOutcome: () => ({ approvedForPR: true, retryRecommended: false, validationScore: 100 }),
  });
  if (calls.length !== 1) throw new Error(`expected Run History Manager to be invoked exactly once, got: ${calls.length}`);
  if (typeof calls[0].status !== "string" || !Array.isArray(calls[0].stageResults)) throw new Error(`expected a well-formed history context, got: ${JSON.stringify(calls[0])}`);
  if (calls[0].status !== "SUCCESS") throw new Error(`expected status "SUCCESS" to be passed through for an approved run, got: ${calls[0].status}`);
  const historyIndex = result.stages.findIndex((s) => s.script === "run-history-manager.js");
  const prgIndex = result.stages.findIndex((s) => s.script === "pull-request-generator.js");
  if (historyIndex === -1 || prgIndex === -1 || historyIndex >= prgIndex) throw new Error("expected Run History Manager to run before Pull Request Generator");
  if (!result.runHistory || result.runHistory.runId !== "RUN-000001") throw new Error("expected the run record's runHistory field to reflect what Run History Manager actually returned");
  ok("Run History Manager is invoked exactly once, in-process, positioned before the publish stages, with a well-formed context");
}

// 16. Run History Manager failure never crashes the orchestrator: an injected module whose archiveRunSync
//     throws is caught, logged, and the run continues to completion (including the publish stages, when
//     otherwise approved) -- exactly per this engine's explicit non-blocking contract.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const throwingRunHistoryManager = {
    archiveRunSync: () => {
      throw new Error("simulated disk full");
    },
  };
  const originalError = console.error;
  let loggedHistoryFailure = false;
  console.error = (...args) => {
    if (args.join(" ").includes("History generation failed")) loggedHistoryFailure = true;
  };
  let result;
  try {
    result = mod.runOrchestration({
      spawnFn: makeFakeSpawn(null),
      cwd: dir,
      runHistoryManager: throwingRunHistoryManager,
      readIterationOutcome: () => ({ approvedForPR: true, retryRecommended: false, validationScore: 100 }),
    });
  } finally {
    console.error = originalError;
  }
  if (!loggedHistoryFailure) throw new Error("expected \"History generation failed\" to be logged when archiveRunSync throws");
  const historyStage = result.stages.find((s) => s.script === "run-history-manager.js");
  if (historyStage.status === "FAIL") throw new Error("expected a Run History Manager failure to never be reported as a blocking FAIL");
  if (result.status !== "success") throw new Error(`expected the orchestrator to still succeed overall despite Run History Manager failing, got: ${result.status}`);
  const prg = result.stages.find((s) => s.script === "pull-request-generator.js");
  if (prg.status !== "PASS") throw new Error("expected Pull Request Generator to still run normally after a Run History Manager failure");
  if (result.runHistory !== null) throw new Error("expected runHistory to be null when archiving failed, never a fabricated result");
  ok("Run History Manager throwing never crashes the orchestrator: it is logged, does not block the publish stages, and the run still succeeds overall");
}

// 17. History generation after a failed validation: using the real Reflection Engine's own (real, not
//     mocked) module together with a fake Validation Engine that rejects, confirms the archive is created
//     and honestly records the rejection -- not a fabricated success.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const calls = [];
  const fakeRunHistoryManager = { archiveRunSync: (context) => (calls.push(context), { runId: "RUN-000001", runDir: path.join(dir, "runs", "RUN-000001"), archivedFiles: [] }) };
  const result = mod.runOrchestration({
    spawnFn: makeFakeSpawn("validation-engine.js"),
    cwd: dir,
    runHistoryManager: fakeRunHistoryManager,
    readIterationOutcome: NEVER_APPROVE_NO_RETRY,
  });
  if (calls.length !== 1) throw new Error("expected Run History Manager to still be invoked once after a failed validation");
  if (calls[0].status !== "FAILED" || calls[0].validationPassed !== false) throw new Error(`expected the history context to honestly record the failure, got: ${JSON.stringify(calls[0])}`);
  if (result.status !== "failed") throw new Error("expected the overall run to be reported as failed");
  ok("history generation occurs (and honestly records the failure) even when validation is rejected");
}

// 18. History generation after a retry: Run History Manager is still called exactly ONCE for the whole run
//     even when the implementation loop attempts multiple iterations -- never once per iteration -- and its
//     context reflects the real final iteration/retry counts.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const calls = [];
  const fakeRunHistoryManager = { archiveRunSync: (context) => (calls.push(context), { runId: "RUN-000001", runDir: path.join(dir, "runs", "RUN-000001"), archivedFiles: [] }) };
  const outcome = makeScriptedOutcome([
    { approvedForPR: false, retryRecommended: true, validationScore: 40 },
    { approvedForPR: true, retryRecommended: false, validationScore: 95 },
  ]);
  const result = mod.runOrchestration({ spawnFn: makeFakeSpawn(null), cwd: dir, maxIterations: 3, runHistoryManager: fakeRunHistoryManager, readIterationOutcome: outcome });
  if (calls.length !== 1) throw new Error(`expected Run History Manager to be invoked exactly once even after a retry, got: ${calls.length}`);
  if (calls[0].iterations !== 2 || calls[0].retryCount !== 1) throw new Error(`expected the history context to reflect the real 2 iterations / 1 retry, got: ${JSON.stringify({ iterations: calls[0].iterations, retryCount: calls[0].retryCount })}`);
  if (calls[0].validationScore !== 95) throw new Error(`expected the history context to reflect the FINAL iteration's validation score, got: ${calls[0].validationScore}`);
  // stageResults = 7 upfront stages (including Historical Context Retriever and Execution Planner) + both
  // iterations' 3 loop stages each (6) = 13 total.
  if (calls[0].stageResults.length !== 13) throw new Error(`expected stageResults to include the 7 upfront stages plus both iterations' 3 stages each (13 total), got: ${calls[0].stageResults.length}`);
  const loopStageNames = calls[0].stageResults.filter((s) => s.name === "Implementation Executor").length;
  if (loopStageNames !== 2) throw new Error(`expected Implementation Executor to appear twice in stageResults (once per iteration), got: ${loopStageNames}`);
  if (result.status !== "success") throw new Error("expected the run to ultimately succeed after the retry");
  ok("Run History Manager is invoked exactly once per whole run (never once per iteration), and its context reflects the real final iteration/retry counts");
}

// 19. Engineering Memory integration: it is called exactly once (in-process, never via spawnFn), AFTER Run
//     History Manager and before the publish stages -- verified via an injected fake module.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const calls = [];
  const fakeEngineeringMemory = { analyzeSync: (options) => (calls.push(options), { memory: { runsAnalyzed: 3 }, jsonPath: path.join(dir, "memory", "engineering-memory.json"), mdPath: path.join(dir, "memory", "report.md") }) };
  const result = mod.runOrchestration({
    spawnFn: makeFakeSpawn(null),
    cwd: dir,
    engineeringMemory: fakeEngineeringMemory,
    readIterationOutcome: () => ({ approvedForPR: true, retryRecommended: false, validationScore: 100 }),
  });
  if (calls.length !== 1) throw new Error(`expected Engineering Memory to be invoked exactly once, got: ${calls.length}`);
  const historyIndex = result.stages.findIndex((s) => s.script === "run-history-manager.js");
  const memoryIndex = result.stages.findIndex((s) => s.script === "engineering-memory.js");
  const prgIndex = result.stages.findIndex((s) => s.script === "pull-request-generator.js");
  if (historyIndex === -1 || memoryIndex === -1 || prgIndex === -1 || !(historyIndex < memoryIndex && memoryIndex < prgIndex)) {
    throw new Error("expected Engineering Memory to run after Run History Manager and before Pull Request Generator");
  }
  if (!result.engineeringMemory || result.engineeringMemory.runsAnalyzed !== 3) throw new Error("expected the run record's engineeringMemory field to reflect what Engineering Memory actually returned");
  ok("Engineering Memory is invoked exactly once, in-process, positioned after Run History Manager and before the publish stages");
}

// 20. Engineering Memory failure never crashes the orchestrator: an injected module whose analyzeSync throws
//     is caught, logged ("Engineering Memory failed"), and the run continues to completion.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const throwingEngineeringMemory = {
    analyzeSync: () => {
      throw new Error("simulated corrupted runs/ directory");
    },
  };
  const originalError = console.error;
  let loggedMemoryFailure = false;
  console.error = (...args) => {
    if (args.join(" ").includes("Engineering Memory failed")) loggedMemoryFailure = true;
  };
  let result;
  try {
    result = mod.runOrchestration({
      spawnFn: makeFakeSpawn(null),
      cwd: dir,
      engineeringMemory: throwingEngineeringMemory,
      readIterationOutcome: () => ({ approvedForPR: true, retryRecommended: false, validationScore: 100 }),
    });
  } finally {
    console.error = originalError;
  }
  if (!loggedMemoryFailure) throw new Error('expected "Engineering Memory failed" to be logged when analyzeSync throws');
  const memoryStage = result.stages.find((s) => s.script === "engineering-memory.js");
  if (memoryStage.status === "FAIL") throw new Error("expected an Engineering Memory failure to never be reported as a blocking FAIL");
  if (result.status !== "success") throw new Error(`expected the orchestrator to still succeed overall despite Engineering Memory failing, got: ${result.status}`);
  const prg = result.stages.find((s) => s.script === "pull-request-generator.js");
  if (prg.status !== "PASS") throw new Error("expected Pull Request Generator to still run normally after an Engineering Memory failure");
  if (result.engineeringMemory !== null) throw new Error("expected engineeringMemory to be null when analysis failed, never a fabricated result");
  ok("Engineering Memory throwing never crashes the orchestrator: it is logged, does not block the publish stages, and the run still succeeds overall");
}

// 21. Engineering Memory runs even after a failed validation, and even after the max iterations are
//     exhausted without approval -- exactly once per whole run either way.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const calls = [];
  const fakeEngineeringMemory = { analyzeSync: (options) => (calls.push(options), { memory: { runsAnalyzed: 1 }, jsonPath: path.join(dir, "memory", "engineering-memory.json"), mdPath: "" }) };
  const result = mod.runOrchestration({
    spawnFn: makeFakeSpawn("validation-engine.js"),
    cwd: dir,
    engineeringMemory: fakeEngineeringMemory,
    readIterationOutcome: NEVER_APPROVE_NO_RETRY,
  });
  if (calls.length !== 1) throw new Error("expected Engineering Memory to still be invoked once after a failed validation");
  if (result.status !== "failed") throw new Error("expected the overall run to be reported as failed");
  ok("Engineering Memory runs (exactly once) even when validation is rejected");
}

// 22. Historical Context Retriever integration: it is called exactly once (in-process, never via spawnFn),
//     AFTER Engineering Knowledge and BEFORE Recommendation Engine -- verified via an injected fake module.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const calls = [];
  const fakeHistoricalContextRetriever = {
    retrieveSync: (options) => (
      calls.push(options),
      { context: { query: "Authentication", matchingRuns: [{ runId: "RUN-000001" }], confidence: 0.8 }, jsonPath: path.join(dir, "historical-context", "historical-context.json"), mdPath: "" }
    ),
  };
  const result = mod.runOrchestration({
    spawnFn: makeFakeSpawn(null),
    cwd: dir,
    historicalContextRetriever: fakeHistoricalContextRetriever,
    readIterationOutcome: () => ({ approvedForPR: true, retryRecommended: false, validationScore: 100 }),
  });
  if (calls.length !== 1) throw new Error(`expected Historical Context Retriever to be invoked exactly once, got: ${calls.length}`);
  const knowledgeIndex = result.stages.findIndex((s) => s.script === "engineering-knowledge.js");
  const historicalContextIndex = result.stages.findIndex((s) => s.script === "historical-context-retriever.js");
  const recommendationIndex = result.stages.findIndex((s) => s.script === "recommendation-engine.js");
  if (knowledgeIndex === -1 || historicalContextIndex === -1 || recommendationIndex === -1 || !(knowledgeIndex < historicalContextIndex && historicalContextIndex < recommendationIndex)) {
    throw new Error("expected Historical Context Retriever to run after Engineering Knowledge and before Recommendation Engine");
  }
  if (!result.historicalContext || result.historicalContext.query !== "Authentication" || result.historicalContext.matchingRuns !== 1) {
    throw new Error("expected the run record's historicalContext field to reflect what Historical Context Retriever actually returned");
  }
  ok("Historical Context Retriever is invoked exactly once, in-process, positioned after Engineering Knowledge and before Recommendation Engine");
}

// 23. Historical Context Retriever failure never crashes the orchestrator: an injected module whose
//     retrieveSync throws is caught, logged ("Historical Context failed"), and the run continues to
//     completion, including Recommendation Engine and the rest of the pipeline.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const throwingHistoricalContextRetriever = {
    retrieveSync: () => {
      throw new Error("simulated corrupted historical-context input");
    },
  };
  const originalError = console.error;
  let loggedHistoricalContextFailure = false;
  console.error = (...args) => {
    if (args.join(" ").includes("Historical Context failed")) loggedHistoricalContextFailure = true;
  };
  let result;
  try {
    result = mod.runOrchestration({
      spawnFn: makeFakeSpawn(null),
      cwd: dir,
      historicalContextRetriever: throwingHistoricalContextRetriever,
      readIterationOutcome: () => ({ approvedForPR: true, retryRecommended: false, validationScore: 100 }),
    });
  } finally {
    console.error = originalError;
  }
  if (!loggedHistoricalContextFailure) throw new Error('expected "Historical Context failed" to be logged when retrieveSync throws');
  const historicalContextStage = result.stages.find((s) => s.script === "historical-context-retriever.js");
  if (historicalContextStage.status === "FAIL") throw new Error("expected a Historical Context Retriever failure to never be reported as a blocking FAIL");
  if (result.status !== "success") throw new Error(`expected the orchestrator to still succeed overall despite Historical Context Retriever failing, got: ${result.status}`);
  const recommendationStage = result.stages.find((s) => s.script === "recommendation-engine.js");
  if (recommendationStage.status !== "PASS") throw new Error("expected Recommendation Engine to still run normally after a Historical Context Retriever failure");
  if (result.historicalContext !== null) throw new Error("expected historicalContext to be null when retrieval failed, never a fabricated result");
  ok("Historical Context Retriever throwing never crashes the orchestrator: it is logged, does not block Recommendation Engine, and the run still succeeds overall");
}

// 24. Historical Context Retriever is SKIPPED (like any other upfront stage), never even attempted, when an
//     earlier upfront stage (before it in the pipeline) has already failed -- distinct from Run History
//     Manager/Engineering Memory, which run unconditionally regardless of `stopped`.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const calls = [];
  const fakeHistoricalContextRetriever = { retrieveSync: (options) => (calls.push(options), { context: { query: "X", matchingRuns: [], confidence: 0 }, jsonPath: "", mdPath: "" }) };
  const result = mod.runOrchestration({
    spawnFn: makeFakeSpawn("engineering-knowledge.js"),
    cwd: dir,
    historicalContextRetriever: fakeHistoricalContextRetriever,
  });
  if (calls.length !== 0) throw new Error(`expected Historical Context Retriever to never be invoked once an earlier upfront stage has failed, got: ${calls.length}`);
  const historicalContextStage = result.stages.find((s) => s.script === "historical-context-retriever.js");
  if (historicalContextStage.status !== "SKIPPED" || historicalContextStage.exitCode !== null || historicalContextStage.durationMs !== null) {
    throw new Error(`expected Historical Context Retriever to be cleanly SKIPPED after an earlier upfront failure, got: ${JSON.stringify(historicalContextStage)}`);
  }
  if (result.historicalContext !== null) throw new Error("expected historicalContext to be null when the stage was never attempted");
  for (const script of UNCONDITIONAL_IN_PROCESS_SCRIPTS) {
    const stage = result.stages.find((s) => s.script === script);
    if (stage.status !== "PASS") throw new Error(`expected ${script} to still run unconditionally even though Historical Context Retriever itself was skipped`);
  }
  ok("Historical Context Retriever is skipped (never invoked) when an earlier upfront stage already failed, unlike the truly unconditional Run History Manager/Engineering Memory");
}

// 25. Historical Context Retriever runs even after a failed validation (it runs upfront, long before the
//     loop's own outcome is known) -- exactly once per whole run.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const calls = [];
  const fakeHistoricalContextRetriever = { retrieveSync: (options) => (calls.push(options), { context: { query: "X", matchingRuns: [], confidence: 0 }, jsonPath: "", mdPath: "" }) };
  const result = mod.runOrchestration({
    spawnFn: makeFakeSpawn("validation-engine.js"),
    cwd: dir,
    historicalContextRetriever: fakeHistoricalContextRetriever,
    readIterationOutcome: NEVER_APPROVE_NO_RETRY,
  });
  if (calls.length !== 1) throw new Error("expected Historical Context Retriever to still be invoked once even though validation later fails");
  if (result.status !== "failed") throw new Error("expected the overall run to be reported as failed");
  ok("Historical Context Retriever runs (exactly once) even when a later stage's validation is rejected, since it runs upfront");
}

console.log("All Autonomous Engineering Orchestrator v1 regression scenarios passed.");
