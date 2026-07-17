#!/usr/bin/env node
// Run #37 hotfix regression coverage: reconcileRuntimeResult() must canonicalize every successful
// runtime/provider report into the exact contract Result Gate enforces (scripts/agent-gatekeeper.js
// validateResult()), deterministically backfilling only what the orchestration layer genuinely knows
// (runtime identity) and failing closed -- never fabricating -- when truthful narrative content
// (implementation_summary / known_limitations / recommended_next_direction) is missing.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const gatekeeperSource = fs.readFileSync(path.join(repoRoot, "scripts/agent-gatekeeper.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(repoRoot, "scripts/agent-runtime-adapter.js"), "utf8");
const decisionSchemaSource = fs.readFileSync(path.join(repoRoot, ".agent/schemas/decision.schema.json"), "utf8");

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-canonical-result-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/agent-gatekeeper.js"), gatekeeperSource);
  fs.writeFileSync(path.join(dir, "scripts/agent-runtime-adapter.js"), adapterSource);
  fs.mkdirSync(path.join(dir, ".agent/schemas"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".agent/schemas/decision.schema.json"), decisionSchemaSource);
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.email", "test@example.com"], dir);
  run("git", ["config", "user.name", "Test User"], dir);
  writeFile(path.join(dir, "frontend/src/App.js"), "base\n");
  writeFile(path.join(dir, "frontend/package.json"), '{"name":"frontend"}\n');
  run("git", ["add", "."], dir);
  run("git", ["commit", "-q", "-m", "base"], dir);
  return dir;
}

function recordBase(dir) {
  const result = spawnSync("node", ["scripts/agent-gatekeeper.js", "record-base"], { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`record-base failed:\nSTDOUT:${result.stdout}\nSTDERR:${result.stderr}`);
}

function writeDecision(dir, allowedPaths) {
  writeJson(path.join(dir, ".agent/runtime/current-decision.json"), {
    cycle_id: "test-cycle",
    selected_backlog_id: "TEST-1",
    selected_improvement: "test improvement",
    selection_reason: "test",
    declared_scope: "test scope",
    allowed_paths: allowedPaths,
    forbidden_paths: [],
    planned_validation: ["node --check scripts/agent-gatekeeper.js"],
    risk_level: "low"
  });
}

function writeValidationResults(dir) {
  writeJson(path.join(dir, ".agent/runtime/validation-results.json"), [
    { command: "node --check scripts/agent-gatekeeper.js", exit_code: 0, outcome: "passed" }
  ]);
}

function writeRawResult(dir, fields) {
  writeJson(path.join(dir, ".agent/runtime/runtime-result.json"), fields);
}

function readResult(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".agent/runtime/runtime-result.json"), "utf8"));
}

function reconcile(dir) {
  const adapter = require(path.join(dir, "scripts/agent-runtime-adapter.js"));
  return adapter.reconcileRuntimeResult();
}

function runResultGate(dir) {
  return spawnSync("node", ["scripts/agent-gatekeeper.js", "result", ".agent/runtime/runtime-result.json"], { cwd: dir, encoding: "utf8" });
}

function ok(name) {
  console.log(`${name}: observed expected deterministic outcome`);
}

// 1. A canonical successful runtime result (all required fields present) passes reconciliation AND the
//    real Result Gate end-to-end, with changed_files reconciled exactly against the actual delta (diff/
//    report consistency unaffected by this fix).
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeRawResult(dir, {
    cycle_id: "test-cycle",
    runtime: "openhands",
    implementation_summary: "Added a small guard clause to App.js.",
    changed_files: ["frontend/src/App.js"],
    validation: [],
    outcome: "success",
    known_limitations: "None observed.",
    recommended_next_direction: "Proceed with the next backlog item."
  });
  const reconciled = reconcile(dir);
  if (JSON.stringify([...reconciled.changed_files].sort()) !== JSON.stringify(["frontend/src/App.js"])) {
    throw new Error(`canonical result: expected changed_files to match actual delta, got ${JSON.stringify(reconciled.changed_files)}`);
  }
  writeValidationResults(dir);
  const gate = runResultGate(dir);
  if (gate.status !== 0) throw new Error(`canonical result: Result Gate should pass\nSTDOUT:${gate.stdout}\nSTDERR:${gate.stderr}`);
  if (!/Result gate passed/.test(gate.stdout)) throw new Error(`canonical result: expected Result Gate pass message, got: ${gate.stdout}`);
  ok("canonical successful runtime result passes reconciliation and Result Gate end-to-end");
}

// 2. Run #37 style: successful result missing `runtime` (a field the orchestration layer deterministically
//    knows) is normalized -- never trusting whatever value, if any, the model supplied.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeRawResult(dir, {
    cycle_id: "test-cycle",
    // runtime omitted entirely, as in Run #37.
    implementation_summary: "Added a small guard clause to App.js.",
    changed_files: ["frontend/src/App.js"],
    validation: [],
    outcome: "success",
    known_limitations: "None observed.",
    recommended_next_direction: "Proceed with the next backlog item."
  });
  const reconciled = reconcile(dir);
  if (reconciled.runtime !== "openhands") throw new Error(`missing runtime: expected deterministic backfill to "openhands", got ${JSON.stringify(reconciled.runtime)}`);
  const persisted = readResult(dir);
  if (persisted.runtime !== "openhands") throw new Error("missing runtime: backfilled value was not persisted to disk");
  ok("missing runtime field is deterministically backfilled from orchestration ground truth");
}
// 2b. A model-reported `runtime` value is never trusted -- the orchestration layer's identity always wins.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeRawResult(dir, {
    cycle_id: "test-cycle",
    runtime: "some-other-claimed-runtime",
    implementation_summary: "Added a small guard clause to App.js.",
    changed_files: ["frontend/src/App.js"],
    validation: [],
    outcome: "success",
    known_limitations: "None observed.",
    recommended_next_direction: "Proceed with the next backlog item."
  });
  const reconciled = reconcile(dir);
  if (reconciled.runtime !== "openhands") throw new Error(`model-reported runtime: expected orchestration ground truth "openhands" to override the model claim, got ${JSON.stringify(reconciled.runtime)}`);
  ok("model-reported runtime identity is overridden by orchestration ground truth, never trusted");
}

// 3. Required narrative fields the model DID supply survive reconciliation verbatim -- they are preserved,
//    not rewritten or replaced with generic text.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  const distinctiveSummary = "Refactored the App.js guard clause to avoid a null dereference on first render.";
  const distinctiveLimitations = "Did not add a regression test for the null-render path.";
  const distinctiveNextDirection = "Add a unit test covering the first-render null case.";
  writeRawResult(dir, {
    cycle_id: "test-cycle",
    runtime: "openhands",
    implementation_summary: distinctiveSummary,
    changed_files: ["frontend/src/App.js"],
    validation: [],
    outcome: "success",
    known_limitations: distinctiveLimitations,
    recommended_next_direction: distinctiveNextDirection
  });
  const reconciled = reconcile(dir);
  if (reconciled.implementation_summary !== distinctiveSummary) throw new Error("implementation_summary was altered by reconciliation");
  if (reconciled.known_limitations !== distinctiveLimitations) throw new Error("known_limitations was altered by reconciliation");
  if (reconciled.recommended_next_direction !== distinctiveNextDirection) throw new Error("recommended_next_direction was altered by reconciliation");
  ok("truthful narrative fields survive reconciliation unaltered");
}

// 4. Truthful narrative metadata that cannot be derived deterministically -> fail closed, never fabricated.
function expectNarrativeFailure(name, dir, overrides, expectedMissing) {
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeRawResult(dir, {
    cycle_id: "test-cycle",
    runtime: "openhands",
    implementation_summary: "test",
    changed_files: ["frontend/src/App.js"],
    validation: [],
    outcome: "success",
    known_limitations: "none",
    recommended_next_direction: "none",
    ...overrides
  });
  const before = readResult(dir);
  let threw = null;
  try {
    reconcile(dir);
  } catch (error) {
    threw = error;
  }
  if (!threw) throw new Error(`${name}: expected reconciliation to fail closed but it succeeded`);
  for (const field of expectedMissing) {
    if (!threw.message.includes(field)) throw new Error(`${name}: expected error to mention "${field}"\nGot: ${threw.message}`);
  }
  const after = readResult(dir);
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`${name}: runtime-result.json was mutated despite fail-closed reconciliation`);
  ok(name);
}
{
  const dir = makeRepo();
  expectNarrativeFailure("Run #37 style: implementation_summary missing entirely fails closed", dir, { implementation_summary: undefined }, ["implementation_summary"]);
}
{
  // Run #37 exact reproduction: all three narrative fields omitted at once -> every one is named in the
  // single fail-closed error, not silently truncated to just the first missing field.
  const dir = makeRepo();
  expectNarrativeFailure(
    "Run #37 exact reproduction: all three missing narrative fields reported together, fails closed",
    dir,
    { implementation_summary: undefined, known_limitations: undefined, recommended_next_direction: undefined },
    ["implementation_summary", "known_limitations", "recommended_next_direction"]
  );
}
{
  const dir = makeRepo();
  expectNarrativeFailure("empty-string known_limitations fails closed", dir, { known_limitations: "" }, ["known_limitations"]);
}
{
  const dir = makeRepo();
  expectNarrativeFailure("whitespace-only recommended_next_direction fails closed", dir, { recommended_next_direction: "   " }, ["recommended_next_direction"]);
}
{
  const dir = makeRepo();
  expectNarrativeFailure("non-string implementation_summary fails closed", dir, { implementation_summary: 12345 }, ["implementation_summary"]);
}

// After a narrative-completeness failure, openhandsImplementation()'s existing catch block routes the
// error into writeReconciliationFailure(), which already hardcodes every required field -- confirm that
// fallback record is itself a complete, canonical, honestly-"failed" result (not success).
{
  const adapterFn = adapterSource;
  if (!/function writeReconciliationFailure[\s\S]*?runtime: "openhands"[\s\S]*?outcome: "failed"/.test(adapterFn)) {
    throw new Error("writeReconciliationFailure must remain a complete, honest failed-outcome fallback record");
  }
  ok("reconciliation failure fallback record remains complete and honestly non-success");
}

// 5. Diff/report consistency (actualImplementationDelta / scopeViolations) is unaffected: a scope violation
//    still fails closed with its original message even when narrative fields are complete, and precedes the
//    narrative check (no new interference with the existing authorization boundary).
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "backend/server.js"), "out-of-scope change\n");
  writeRawResult(dir, {
    cycle_id: "test-cycle",
    runtime: "openhands",
    implementation_summary: "test",
    changed_files: ["frontend/src/App.js"],
    validation: [],
    outcome: "success",
    known_limitations: "none",
    recommended_next_direction: "none"
  });
  let threw = null;
  try {
    reconcile(dir);
  } catch (error) {
    threw = error;
  }
  if (!threw || !threw.message.includes("out-of-scope path: backend/server.js")) {
    throw new Error(`diff/report consistency: expected unchanged scope-violation error, got: ${threw && threw.message}`);
  }
  ok("existing scope/diff authorization boundary is unaffected by the narrative-field fix");
}

// 6. Failed runtime outcomes are never normalized into success, and are left completely untouched (no
//    runtime backfill, no narrative check, no mutation) even when they are themselves incomplete.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeRawResult(dir, {
    cycle_id: "test-cycle",
    // Deliberately incomplete and outcome=failed, as a model might self-report mid-task.
    changed_files: [],
    validation: [],
    outcome: "failed"
  });
  const before = readResult(dir);
  const reconciled = reconcile(dir);
  if (reconciled.outcome !== "failed") throw new Error(`failed outcome: reconciliation must never change outcome, got ${reconciled.outcome}`);
  const after = readResult(dir);
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("failed outcome: runtime-result.json must remain byte-for-byte untouched by reconciliation");
  ok("incomplete failed-outcome result is left untouched, never normalized into success");
}

// 7. Existing OpenHands/provider fallback deterministic writers remain complete and unaffected by this fix
//    (they were not touched; this documents and locks that contract in place).
{
  const commonFieldContract = ["implementation_summary", "known_limitations", "recommended_next_direction", "outcome:"];
  // writeRuntimeFailure/writeProviderCapacityBlock report a genuine OpenHands execution attempt; `disabled`
  // truthfully reports that no coding-agent runtime executed at all -- each must state its own accurate
  // runtime identity, never "openhands" borrowed from a sibling writer.
  const runtimeTokenByFn = {
    "function writeRuntimeFailure": 'runtime: "openhands"',
    "function writeProviderCapacityBlock": 'runtime: "openhands"',
    "function disabled": 'runtime: "disabled"'
  };
  for (const [fn, runtimeToken] of Object.entries(runtimeTokenByFn)) {
    const start = adapterSource.indexOf(fn);
    if (start === -1) throw new Error(`provider fallback contract: could not locate ${fn} in adapter source`);
    const body = adapterSource.slice(start, start + 900);
    for (const token of [runtimeToken, ...commonFieldContract]) {
      if (!body.includes(token)) throw new Error(`provider fallback contract: ${fn} is missing expected canonical field token "${token}"`);
    }
  }
  ok("existing OpenHands/provider fallback deterministic writers remain complete, truthful, and unaffected");
}

console.log("All canonical runtime-result contract regression scenarios passed.");
