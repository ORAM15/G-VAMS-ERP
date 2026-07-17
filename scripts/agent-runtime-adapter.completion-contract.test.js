#!/usr/bin/env node
// Run #38 hotfix regression coverage: the OpenHands implementation task instructions must embed the
// canonical runtime-result completion contract (scripts/agent-runtime-adapter.js completionContract(),
// reused inside writeTask()) directly and in full, rather than only pointing at the schema file by path --
// a capacity-fallback candidate (e.g. gemini/gemini-3.1-flash-lite) must receive the exact same explicit
// instructions as the primary candidate, since writeTask() runs once before the candidate loop.
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const adapterSource = fs.readFileSync(path.join(repoRoot, "scripts/agent-runtime-adapter.js"), "utf8");
const gatekeeperSource = fs.readFileSync(path.join(repoRoot, "scripts/agent-gatekeeper.js"), "utf8");
const templateSource = fs.readFileSync(path.join(repoRoot, ".agent/runtime/agent-task-template.md"), "utf8");
const resultSchemaSource = fs.readFileSync(path.join(repoRoot, ".agent/schemas/runtime-result.schema.json"), "utf8");
const resultSchema = JSON.parse(resultSchemaSource);

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

// No git repo is needed here: writeTask()/completionContract() only read files directly off disk (task
// template, base-state.json, config.json, current-decision.json, the result schema) -- none of it goes
// through git delta computation, so a plain temp directory fixture is sufficient and keeps this test fast.
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-completion-contract-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/agent-runtime-adapter.js"), adapterSource);
  fs.writeFileSync(path.join(dir, "scripts/agent-gatekeeper.js"), gatekeeperSource);
  writeFile(path.join(dir, ".agent/runtime/agent-task-template.md"), templateSource);
  writeFile(path.join(dir, ".agent/schemas/runtime-result.schema.json"), resultSchemaSource);
  writeJson(path.join(dir, ".agent/runtime/base-state.json"), { trusted_base_sha: "0".repeat(40) });
  writeJson(path.join(dir, ".agent/runtime/config.json"), {
    schema_version: 2,
    runtime_mode: "openhands",
    runtime_version: "1.16.0",
    provider: "gemini",
    model: null,
    diff_thresholds: { max_changed_files: 12, max_line_changes: 500 }
  });
  writeJson(path.join(dir, ".agent/runtime/current-decision.json"), {
    cycle_id: "test-cycle",
    selected_backlog_id: "TEST-1",
    allowed_paths: ["frontend/src/App.js"],
    risk_level: "low"
  });
  return dir;
}

function ok(name) {
  console.log(`${name}: observed expected deterministic outcome`);
}

// 1 & 2. Both the primary candidate and any capacity-fallback candidate read the exact same task file,
//    because writeTask() takes no model/candidate parameter and completionContract() embeds the full
//    canonical field list, sourced from the real schema, directly in the instructions.
{
  const dir = makeFixture();
  const adapter = require(path.join(dir, "scripts/agent-runtime-adapter.js"));
  adapter.writeTask("implementation");
  const taskText = fs.readFileSync(adapter.taskPath("implementation"), "utf8");

  if (!taskText.includes("REQUIRED COMPLETION REPORT")) {
    throw new Error("task instructions must embed an explicit REQUIRED COMPLETION REPORT section");
  }
  for (const field of resultSchema.required) {
    if (!taskText.includes(field)) throw new Error(`task instructions must explicitly name required field "${field}"`);
  }
  for (const field of ["implementation_summary", "known_limitations", "recommended_next_direction"]) {
    if (!new RegExp(`-\\s*${field}:`).test(taskText)) {
      throw new Error(`task instructions must give explicit per-field guidance for narrative field "${field}"`);
    }
  }
  ok("implementation task instructions embed the full canonical completion contract, not just a schema-file reference");

  // Re-running writeTask() (simulating the fallback candidate's identical task file, since openhandsImplementation()
  // calls writeTask() once before iterating candidates) produces byte-identical instructions.
  const before = taskText;
  adapter.writeTask("implementation");
  const after = fs.readFileSync(adapter.taskPath("implementation"), "utf8");
  if (before !== after) throw new Error("task instructions must be identical and deterministic across repeated writeTask() calls (candidate-independent)");
  ok("task instructions are candidate-independent: primary and fallback candidates receive an identical contract");
}

// 3. openhandsImplementation() constructs the task exactly once, before selecting/iterating candidates --
//    structurally guaranteeing every candidate (primary and fallback) sees the identical instructions.
{
  const writeTaskCallIndex = adapterSource.indexOf("writeTask(stage)");
  const candidateLoopIndex = adapterSource.indexOf("for (const { model, provider, apiKey } of candidates)");
  if (writeTaskCallIndex === -1 || candidateLoopIndex === -1) {
    throw new Error("could not locate writeTask(stage) call or the candidate fallback loop in openhandsImplementation()");
  }
  if (!(writeTaskCallIndex < candidateLoopIndex)) {
    throw new Error("writeTask(stage) must be called once, before the candidate fallback loop begins, so every candidate reads the same task file");
  }
  const callSites = adapterSource.match(/^\s+writeTask\(stage\);/gm) || [];
  if (callSites.length !== 1) {
    throw new Error(`writeTask(stage) must be called exactly once per implementation attempt, found ${callSites.length} call site(s)`);
  }
  ok("task construction happens exactly once, structurally shared by every implementation candidate");
}

// 4. The embedded contract is sourced from the real schema file and the real REQUIRED_NARRATIVE_FIELDS
//    constant -- not a second, hand-authored, competing field list that could drift out of sync.
{
  if (!/completionContract[\s\S]{0,400}runtime-result\.schema\.json/.test(adapterSource)) {
    throw new Error("completionContract() must read the existing .agent/schemas/runtime-result.schema.json, not invent a parallel schema");
  }
  if (!/REQUIRED_NARRATIVE_FIELDS\.map/.test(adapterSource)) {
    throw new Error("completionContract() must derive narrative field names from the single REQUIRED_NARRATIVE_FIELDS constant reconcileRuntimeResult() enforces, not a duplicated list");
  }
  ok("completion contract is sourced from the existing schema and narrative-field constant, no parallel schema introduced");
}

// 5. Malformed/missing completion output still fails closed at reconciliation -- unaffected by this fix and
//    already covered by scripts/agent-runtime-adapter.canonical-result-contract.test.js (not duplicated here).

// 6. Deterministic runtime identity still cannot be overridden by model output, and authoritative
//    changed_files reconciliation is unaffected -- already covered by
//    scripts/agent-runtime-adapter.canonical-result-contract.test.js (not duplicated here).

// 7. Capacity exhaustion of the first candidate still advances to the next approved candidate: lock in
//    classifyOpenHandsEvidence()'s behavior against the exact Run #38 evidence shape (Gemini free-tier
//    daily quota RESOURCE_EXHAUSTED), and confirm ordinary successful-looking evidence is not misclassified.
{
  const dir = makeFixture();
  const adapter = require(path.join(dir, "scripts/agent-runtime-adapter.js"));
  const outFile = path.join(dir, ".agent/runtime/implementation-openhands.jsonl");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const run38Evidence = JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "Quota exceeded",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [
            {
              quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
              quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
              quotaValue: "20"
            }
          ]
        }
      ],
      model: "gemini-3.5-flash"
    }
  });
  fs.writeFileSync(outFile, `${run38Evidence}\n`);
  const classified = adapter.classifyOpenHandsEvidence("implementation", "gemini");
  if (!classified) throw new Error("Run #38 style RESOURCE_EXHAUSTED quota evidence must be classified as a capacity failure so the loop advances to the next candidate");
  ok("primary candidate's Run #38 quota-exhaustion evidence is classified as a capacity failure (advances to fallback)");

  fs.writeFileSync(outFile, `${JSON.stringify({ action: "finish", args: { outputs: {} } })}\n`);
  const notClassified = adapter.classifyOpenHandsEvidence("implementation", "gemini");
  if (notClassified) throw new Error(`ordinary successful-looking evidence must not be misclassified as a capacity failure, got: ${notClassified}`);
  ok("ordinary successful evidence is not misclassified as a capacity failure");
}

// 8. Incidental lockfile restoration behavior is untouched by this fix (no changes were made to
//    restoreIncidentalLockfileChurn / lockfilePreimplementationContent); covered by
//    scripts/agent-runtime-adapter.incidental-lockfile-restore.test.js (not duplicated here).

console.log("All OpenHands completion-contract regression scenarios passed.");
