#!/usr/bin/env node
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-reconcile-"));
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
  writeFile(path.join(dir, "backend/server.js"), "base\n");
  writeFile(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), '{"v":1}\n');
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

function writeRuntimeResult(dir, changedFiles, outcome = "success") {
  writeJson(path.join(dir, ".agent/runtime/runtime-result.json"), {
    cycle_id: "test-cycle",
    runtime: "openhands",
    implementation_summary: "test",
    changed_files: changedFiles,
    validation: [],
    outcome,
    known_limitations: "none",
    recommended_next_direction: "none"
  });
}

function readResult(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".agent/runtime/runtime-result.json"), "utf8"));
}

function reconcile(dir) {
  const adapter = require(path.join(dir, "scripts/agent-runtime-adapter.js"));
  return adapter.reconcileRuntimeResult();
}

function expectSucceeds(name, dir, expectedChangedFiles) {
  const result = reconcile(dir);
  const got = [...result.changed_files].sort();
  const want = [...expectedChangedFiles].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${name}: expected changed_files ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  const persisted = readResult(dir);
  if (JSON.stringify([...persisted.changed_files].sort()) !== JSON.stringify(want)) {
    throw new Error(`${name}: persisted runtime-result.json changed_files did not match expectation`);
  }
  console.log(`${name}: observed expected deterministic outcome`);
}

function expectThrows(name, dir, expectedSubstring, beforeResultSnapshot) {
  let threw = null;
  try {
    reconcile(dir);
  } catch (error) {
    threw = error;
  }
  if (!threw) throw new Error(`${name}: expected reconciliation to fail closed but it succeeded`);
  if (!threw.message.includes(expectedSubstring)) {
    throw new Error(`${name}: expected error to include "${expectedSubstring}"\nGot: ${threw.message}`);
  }
  if (beforeResultSnapshot !== undefined) {
    const after = fs.existsSync(path.join(dir, ".agent/runtime/runtime-result.json")) ? readResult(dir) : null;
    if (JSON.stringify(after) !== JSON.stringify(beforeResultSnapshot)) {
      throw new Error(`${name}: runtime-result.json was mutated despite fail-closed reconciliation`);
    }
  }
  console.log(`${name}: observed expected deterministic outcome`);
}

// 1. Model reports exact authorized actual delta -> reconciliation preserves/normalizes it successfully.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  expectSucceeds("exact authorized delta preserved", dir, ["frontend/src/App.js"]);
}

// 2. Model omits an authorized actual implementation file -> reconciliation adds it.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js", "frontend/src/Extra.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "frontend/src/Extra.js"), "new\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  expectSucceeds("omitted authorized file is added", dir, ["frontend/src/App.js", "frontend/src/Extra.js"]);
}

// 3. Run #29-style: decision authorizes frontend/package.json; frontend/package-lock.json changes as a
//    legitimate companion; model omits the lockfile -> reconciliation includes it.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/package.json"]);
  writeFile(path.join(dir, "frontend/package.json"), '{"name":"frontend","version":"2.0.0"}\n');
  writeFile(path.join(dir, "frontend/package-lock.json"), "{}\n");
  writeRuntimeResult(dir, ["frontend/package.json"]);
  expectSucceeds("run #29 style: authorized package-lock companion included", dir, ["frontend/package.json", "frontend/package-lock.json"]);
}

// 4. Model invents a changed file absent from actual delta -> reconciliation replaces changed_files with
//    the authoritative actual delta, dropping the invented entry.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeRuntimeResult(dir, ["frontend/src/App.js", "frontend/src/Invented.js"]);
  expectSucceeds("invented file dropped by authoritative replacement", dir, ["frontend/src/App.js"]);
}

// 5. Actual changed file outside decision allowed_paths -> fail closed; must NOT normalize it in.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "backend/server.js"), "changed\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  const before = readResult(dir);
  expectThrows("out-of-scope actual file fails closed", dir, "out-of-scope path: backend/server.js", before);
}

// 6. Actual protected control-plane file -> fail closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "scripts/agent-gatekeeper.js"), `${gatekeeperSource}\n// tampered\n`);
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  const before = readResult(dir);
  expectThrows("protected control-plane file fails closed", dir, "protected control-plane path: scripts/agent-gatekeeper.js", before);
}

// 7. Actual forbidden/sensitive path -> fail closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "id_rsa"), "fake-key-material\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  const before = readResult(dir);
  expectThrows("forbidden sensitive path fails closed", dir, "forbidden secret-bearing path: id_rsa", before);
}

// 8. Unauthorized package-lock.json (no approved companion package.json) -> fail closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "frontend/package-lock.json"), "{}\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  const before = readResult(dir);
  expectThrows("unauthorized package-lock.json fails closed", dir, "out-of-scope path: frontend/package-lock.json", before);
}

// 9. Missing runtime-result.json -> fail closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  let threw = null;
  try {
    reconcile(dir);
  } catch (error) {
    threw = error;
  }
  if (!threw || !threw.message.includes("did not produce")) {
    throw new Error(`missing runtime-result.json: expected fail-closed error, got ${threw && threw.message}`);
  }
  console.log("missing runtime-result.json fails closed: observed expected deterministic outcome");
}

// 10. Malformed runtime-result.json -> fail closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, ".agent/runtime/runtime-result.json"), "{ not valid json");
  let threw = null;
  try {
    reconcile(dir);
  } catch (error) {
    threw = error;
  }
  if (!threw || !threw.message.includes("not valid JSON")) {
    throw new Error(`malformed runtime-result.json: expected fail-closed error, got ${threw && threw.message}`);
  }
  console.log("malformed runtime-result.json fails closed: observed expected deterministic outcome");
}

// 11. Pre-existing generated context file unchanged after baseline -> not added to changed_files.
{
  const dir = makeRepo();
  writeFile(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), '{"v":2,"regenerated":true}\n');
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  expectSucceeds("untouched pre-existing generated context excluded", dir, ["frontend/src/App.js"]);
}

// 12. Pre-existing dirty file further modified by implementation -> detected and subjected to scope
//     authorization (denied here because it is outside allowed_paths and not an agent-state path).
{
  const dir = makeRepo();
  writeFile(path.join(dir, "backend/notes.md"), "pre-existing draft\n");
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "backend/notes.md"), "further modified by implementation\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  const before = readResult(dir);
  expectThrows("further-modified pre-existing file is subjected to scope authorization", dir, "out-of-scope path: backend/notes.md", before);
}

// 13. .agent/runtime evidence remains excluded from implementation delta.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, ".agent/runtime/trace.txt"), "ignored runtime evidence\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  expectSucceeds("runtime evidence path excluded from reconciled delta", dir, ["frontend/src/App.js"]);
}

// Bonus: non-success outcomes are left untouched by reconciliation; the Evidence/Result Gate contract for
// blocked/no_safe_improvement is owned entirely by validateRuntimeReportDiff(), unchanged by this feature.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeRuntimeResult(dir, [], "blocked");
  const before = readResult(dir);
  const result = reconcile(dir);
  if (result.outcome !== "blocked" || (result.changed_files || []).length !== 0) {
    throw new Error("blocked outcome: reconciliation must not alter a non-success result");
  }
  const after = readResult(dir);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error("blocked outcome: runtime-result.json must remain byte-for-byte untouched by reconciliation");
  }
  console.log("blocked outcome left untouched by reconciliation: observed expected deterministic outcome");
}

console.log("All runtime-result reconciliation regression scenarios passed.");
