#!/usr/bin/env node
// Reflection Engine v1 regression coverage: every deterministic derivation (decideRetry/buildNextObjective)
// is exercised against hand-crafted validation.json fixtures (decoupling these tests from Validation
// Engine's own internals), plus one true end-to-end run proving the real chain through Validation Engine
// actually works, for both an approved and a policy-blocked outcome.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "scripts/reflection-engine.js"), "utf8");
const repoIntelSource = fs.readFileSync(path.join(repoRoot, "scripts/repository-intelligence.js"), "utf8");
const engKnowledgeSource = fs.readFileSync(path.join(repoRoot, "scripts/engineering-knowledge.js"), "utf8");
const recEngineSource = fs.readFileSync(path.join(repoRoot, "scripts/recommendation-engine.js"), "utf8");
const decisionEngineSource = fs.readFileSync(path.join(repoRoot, "scripts/decision-engine.js"), "utf8");
const implRequestEngineSource = fs.readFileSync(path.join(repoRoot, "scripts/implementation-request-engine.js"), "utf8");
const implExecutorSource = fs.readFileSync(path.join(repoRoot, "scripts/implementation-executor.js"), "utf8");
const validationEngineSource = fs.readFileSync(path.join(repoRoot, "scripts/validation-engine.js"), "utf8");

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

const BASE_RULES = [
  { id: "RULE-001", description: "Execution completed successfully.", status: "PASS", details: "ok" },
  { id: "RULE-002", description: "Only approved files modified.", status: "PASS", details: "ok" },
  { id: "RULE-003", description: "Tests executed.", status: "PASS", details: "ok" },
  { id: "RULE-004", description: "Tests passed.", status: "PASS", details: "ok" },
  { id: "RULE-005", description: "Provider evidence present for real providers.", status: "SKIPPED", details: "stub" },
  { id: "RULE-006", description: "Execution policy respected.", status: "PASS", details: "ok" },
];

function validationFixture(overrides) {
  return {
    generatedFrom: { implementationRequest: "implementation-request/implementation-request.json", execution: "execution/execution.json", patchSummary: "execution/patch-summary.json" },
    status: "approved",
    score: 100,
    approvedForPR: true,
    rules: BASE_RULES.map((rule) => ({ ...rule })),
    warnings: [],
    errors: [],
    timestamp: "2026-01-02T00:15:00.000Z",
    ...overrides,
  };
}

function withRuleStatus(rules, id, status) {
  return rules.map((rule) => (rule.id === id ? { ...rule, status } : rule));
}

function makeFixture(includeUpstreamSources) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reflection-engine-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/reflection-engine.js"), source);
  if (includeUpstreamSources) {
    fs.writeFileSync(path.join(dir, "scripts/repository-intelligence.js"), repoIntelSource);
    fs.writeFileSync(path.join(dir, "scripts/engineering-knowledge.js"), engKnowledgeSource);
    fs.writeFileSync(path.join(dir, "scripts/recommendation-engine.js"), recEngineSource);
    fs.writeFileSync(path.join(dir, "scripts/decision-engine.js"), decisionEngineSource);
    fs.writeFileSync(path.join(dir, "scripts/implementation-request-engine.js"), implRequestEngineSource);
    fs.writeFileSync(path.join(dir, "scripts/implementation-executor.js"), implExecutorSource);
    fs.writeFileSync(path.join(dir, "scripts/validation-engine.js"), validationEngineSource);
  }
  return dir;
}

function requireFixture(dir) {
  return require(path.join(dir, "scripts/reflection-engine.js"));
}

function ok(name) {
  console.log(`${name}: observed expected deterministic outcome`);
}

// 1. Missing validation.json fails closed with a clear, actionable error naming the fix.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  let threw = null;
  try {
    mod.loadValidation(path.join(dir, "validation/validation.json"));
  } catch (error) {
    threw = error;
  }
  if (!threw || !/not found/.test(threw.message) || !/node scripts\/validation-engine\.js/.test(threw.message)) {
    throw new Error(`expected a clear missing-file error naming the fix, got: ${threw && threw.message}`);
  }
  ok("loadValidation fails closed with an actionable error when validation.json is missing");
}

// 2. Invalid JSON fails closed.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const file = path.join(dir, "validation/validation.json");
  writeFile(file, "{ not valid json");
  let threw = null;
  try {
    mod.loadValidation(file);
  } catch (error) {
    threw = error;
  }
  if (!threw || !/not valid JSON/.test(threw.message)) throw new Error(`expected a clear invalid-JSON error, got: ${threw && threw.message}`);
  ok("loadValidation fails closed on invalid JSON");
}

// 3. Malformed (structurally invalid) validation.json fails closed: unrecognized status, and non-array rules.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const file = path.join(dir, "validation/validation.json");

  writeJson(file, validationFixture({ status: "not-a-real-status" }));
  let threw = null;
  try {
    mod.loadValidation(file);
  } catch (error) {
    threw = error;
  }
  if (!threw || !/unrecognized status/.test(threw.message)) throw new Error(`expected a clear unrecognized-status error, got: ${threw && threw.message}`);

  writeJson(file, validationFixture({ rules: "not-an-array" }));
  let threw2 = null;
  try {
    mod.loadValidation(file);
  } catch (error) {
    threw2 = error;
  }
  if (!threw2 || !/non-array rules/.test(threw2.message)) throw new Error(`expected a clear non-array-rules error, got: ${threw2 && threw2.message}`);

  ok("loadValidation fails closed on malformed (structurally invalid) validation.json");
}

// 4. Approved validation: no retry recommended, no failed rules, no next objective.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const reflection = mod.buildReflectionReport(validationFixture());
  if (reflection.retryRecommended !== false) throw new Error("expected no retry to be recommended for an approved validation");
  if (reflection.failedRules.length !== 0) throw new Error("expected no failed rules for an approved validation");
  if (reflection.nextObjective !== null) throw new Error("expected no next objective for an approved validation");
  if (!/no further implementation attempt is needed/.test(reflection.reason)) throw new Error(`expected an approval-specific reason, got: ${reflection.reason}`);
  ok("an approved validation recommends no retry and produces no next objective");
}

// 5. Skipped validation: no retry recommended, with a distinct reason from the approved case.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const reflection = mod.buildReflectionReport(validationFixture({ status: "skipped", score: 0, approvedForPR: false, rules: BASE_RULES.map((r) => ({ ...r, status: "SKIPPED" })) }));
  if (reflection.retryRecommended !== false) throw new Error("expected no retry to be recommended when nothing was executed");
  if (!/nothing to retry/.test(reflection.reason)) throw new Error(`expected a skipped-specific reason, got: ${reflection.reason}`);
  ok("a skipped validation (nothing executed) recommends no retry, with a distinct reason");
}

// 6. Rejected due to a policy violation (RULE-006): no retry recommended, even if other rules also failed --
//    a policy problem is never something another automated attempt can fix.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const rules = withRuleStatus(withRuleStatus(BASE_RULES, "RULE-001", "FAIL"), "RULE-006", "FAIL");
  const reflection = mod.buildReflectionReport(validationFixture({ status: "rejected", score: 20, approvedForPR: false, rules }));
  if (reflection.retryRecommended !== false) throw new Error("expected no retry to be recommended when RULE-006 (policy) failed");
  if (!/human or configuration action/.test(reflection.reason)) throw new Error(`expected a policy-specific reason, got: ${reflection.reason}`);
  if (reflection.nextObjective !== null) throw new Error("expected no next objective when the failure is a policy violation, not something to fix by retrying");
  ok("a policy violation (RULE-006 failed) never recommends a retry, regardless of what else failed");
}

// 7. Rejected due to fixable rule failures (no RULE-006): retry is recommended, and the next objective names
//    a concrete instruction per failed rule.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const rules = withRuleStatus(withRuleStatus(BASE_RULES, "RULE-002", "FAIL"), "RULE-004", "FAIL");
  const reflection = mod.buildReflectionReport(validationFixture({ status: "rejected", score: 40, approvedForPR: false, rules }));
  if (reflection.retryRecommended !== true) throw new Error("expected a retry to be recommended for fixable rule failures");
  if (reflection.failedRules.length !== 2 || !reflection.failedRules.some((r) => r.id === "RULE-002") || !reflection.failedRules.some((r) => r.id === "RULE-004")) {
    throw new Error(`expected exactly the two failed rules to be reported, got: ${JSON.stringify(reflection.failedRules)}`);
  }
  if (!reflection.nextObjective || !reflection.nextObjective.includes("only the files explicitly listed") || !reflection.nextObjective.includes("every executed test passes")) {
    throw new Error(`expected the next objective to name both concrete fixes, got: ${reflection.nextObjective}`);
  }
  ok("fixable rule failures (no policy violation) recommend a retry with a concrete, grounded next objective");
}

// 8. Contradictory validation state (status "rejected" but no rule actually failed) fails closed on the
//    retry decision -- never guesses.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const reflection = mod.buildReflectionReport(validationFixture({ status: "rejected", score: 90, approvedForPR: false }));
  if (reflection.retryRecommended !== false) throw new Error("expected no retry to be blindly recommended for a contradictory validation record");
  if (!/contradictory validation record/.test(reflection.reason)) throw new Error(`expected a contradiction-specific reason, got: ${reflection.reason}`);
  ok("a contradictory validation record (rejected with no failed rule) never blindly recommends a retry");
}

// 9. Markdown generation includes every required section.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const rules = withRuleStatus(BASE_RULES, "RULE-004", "FAIL");
  const reflection = mod.buildReflectionReport(validationFixture({ status: "rejected", score: 60, approvedForPR: false, rules }));
  const markdown = mod.renderMarkdown(reflection);
  for (const heading of ["# Reflection Engine Report", "## Validation Status", "## Retry Recommended", "## Reason", "## Failed Rules", "## Next Objective", "## Next Step"]) {
    if (!markdown.includes(heading)) throw new Error(`expected markdown to include "${heading}"`);
  }
  if (!markdown.includes("RULE-004")) throw new Error("expected the failed rules section to name RULE-004");
  ok("renderMarkdown includes every required section and names the actual failed rule(s)");
}

// 10. CLI: fails closed with no validation.json; succeeds and writes both files with valid input.
{
  const dir = makeFixture();
  const failResult = spawnSync("node", ["scripts/reflection-engine.js"], { cwd: dir, encoding: "utf8" });
  if (failResult.status === 0) throw new Error(`expected the CLI to fail closed with no validation.json present:\n${failResult.stdout}`);
  if (!/validation\.json not found/.test(failResult.stderr)) throw new Error(`expected a clear missing-input error on stderr, got:\n${failResult.stderr}`);

  writeJson(path.join(dir, "validation/validation.json"), validationFixture());
  const successResult = spawnSync("node", ["scripts/reflection-engine.js"], { cwd: dir, encoding: "utf8" });
  if (successResult.status !== 0) throw new Error(`expected the CLI to succeed with valid input:\n${successResult.stdout}\n${successResult.stderr}`);
  const written = JSON.parse(fs.readFileSync(path.join(dir, "reflection/reflection-report.json"), "utf8"));
  if (written.validationStatus !== "approved") throw new Error("expected the CLI-written report to reflect the fixture validation");

  ok("the CLI fails closed with no input and succeeds end-to-end with valid input present");
}

// 11. Environment overrides: VALIDATION_PATH and REFLECTION_OUTPUT_DIR both override the default locations.
{
  const dir = makeFixture();
  const customValidation = path.join(dir, "custom-validation/validation.json");
  writeJson(customValidation, validationFixture());
  const previous = { VALIDATION_PATH: process.env.VALIDATION_PATH, REFLECTION_OUTPUT_DIR: process.env.REFLECTION_OUTPUT_DIR };
  process.env.VALIDATION_PATH = "custom-validation/validation.json";
  process.env.REFLECTION_OUTPUT_DIR = "custom-output/nested";
  try {
    const mod = requireFixture(dir);
    if (mod.validationPath !== customValidation) throw new Error(`expected overridden validation path, got: ${mod.validationPath}`);
    if (mod.outputDir !== path.join(dir, "custom-output", "nested")) throw new Error(`expected overridden output directory, got: ${mod.outputDir}`);
    const validation = mod.loadValidation(mod.validationPath);
    const reflection = mod.buildReflectionReport(validation);
    const { jsonPath, mdPath } = mod.writeOutputs(reflection);
    if (path.basename(jsonPath) !== "reflection-report.json" || path.basename(mdPath) !== "reflection-report.md") throw new Error("expected the fixed output filenames regardless of directory override");
    if (!fs.existsSync(jsonPath) || !fs.existsSync(mdPath)) throw new Error("expected both output files to exist under the overridden output directory");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  ok("VALIDATION_PATH and REFLECTION_OUTPUT_DIR override the default input/output locations");
}

// 12. End-to-end execution: the real chain through Validation Engine, using the real upstream sources,
//     produces a valid reflection report for both an approved (EXECUTION_APPROVED=true) and a policy-blocked
//     (no approval) real outcome.
{
  const dir = makeFixture(true);
  for (const script of ["repository-intelligence.js", "engineering-knowledge.js", "recommendation-engine.js", "decision-engine.js", "implementation-request-engine.js"]) {
    const run = spawnSync("node", [`scripts/${script}`], { cwd: dir, encoding: "utf8" });
    if (run.status !== 0) throw new Error(`${script} run failed:\n${run.stdout}\n${run.stderr}`);
  }

  spawnSync("node", ["scripts/implementation-executor.js"], { cwd: dir, encoding: "utf8" }); // no EXECUTION_APPROVED -> blocked
  spawnSync("node", ["scripts/validation-engine.js"], { cwd: dir, encoding: "utf8" });
  const blockedReflectionRun = spawnSync("node", ["scripts/reflection-engine.js"], { cwd: dir, encoding: "utf8" });
  if (blockedReflectionRun.status !== 0) throw new Error(`expected the Reflection Engine CLI to succeed even for a rejected/blocked validation:\n${blockedReflectionRun.stdout}\n${blockedReflectionRun.stderr}`);
  const blockedReflection = JSON.parse(fs.readFileSync(path.join(dir, "reflection", "reflection-report.json"), "utf8"));
  const blockedValidation = JSON.parse(fs.readFileSync(path.join(dir, "validation", "validation.json"), "utf8"));
  if (blockedValidation.status === "rejected") {
    if (blockedReflection.retryRecommended !== false) throw new Error("expected no retry to be recommended for a real policy-blocked (no human approval) execution");
  }

  const approvedRun = spawnSync("node", ["scripts/implementation-executor.js"], { cwd: dir, encoding: "utf8", env: { ...process.env, EXECUTION_APPROVED: "true" } });
  if (approvedRun.status !== 0) throw new Error(`implementation-executor.js (approved) run failed:\n${approvedRun.stdout}\n${approvedRun.stderr}`);
  spawnSync("node", ["scripts/validation-engine.js"], { cwd: dir, encoding: "utf8" });
  const approvedReflectionRun = spawnSync("node", ["scripts/reflection-engine.js"], { cwd: dir, encoding: "utf8" });
  if (approvedReflectionRun.status !== 0) throw new Error(`expected the Reflection Engine CLI to succeed for an approved validation:\n${approvedReflectionRun.stdout}\n${approvedReflectionRun.stderr}`);
  const approvedValidation = JSON.parse(fs.readFileSync(path.join(dir, "validation", "validation.json"), "utf8"));
  const approvedReflection = JSON.parse(fs.readFileSync(path.join(dir, "reflection", "reflection-report.json"), "utf8"));
  if (approvedValidation.status === "approved" && approvedReflection.retryRecommended !== false) {
    throw new Error("expected no retry to be recommended once the real validation was actually approved");
  }

  ok("the real chain through Validation Engine produces a valid reflection report for both a policy-blocked and an approved real outcome");
}

console.log("All Reflection Engine v1 regression scenarios passed.");
