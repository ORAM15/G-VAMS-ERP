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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-lockfile-restore-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/agent-gatekeeper.js"), gatekeeperSource);
  fs.writeFileSync(path.join(dir, "scripts/agent-runtime-adapter.js"), adapterSource);
  fs.mkdirSync(path.join(dir, ".agent/schemas"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".agent/schemas/decision.schema.json"), decisionSchemaSource);
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.email", "test@example.com"], dir);
  run("git", ["config", "user.name", "Test User"], dir);
  run("git", ["config", "core.autocrlf", "false"], dir);
  writeFile(path.join(dir, "frontend/src/App.js"), "base\n");
  writeFile(path.join(dir, "frontend/package.json"), '{"name":"frontend"}\n');
  writeFile(path.join(dir, "frontend/package-lock.json"), "base-lock-content\n");
  writeFile(path.join(dir, "backend/server.js"), "base\n");
  writeFile(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), '{"v":1}\n');
  run("git", ["add", "."], dir);
  run("git", ["commit", "-q", "-m", "base"], dir);
  return dir;
}

function recordBase(dir) {
  const result = spawnSync("node", ["scripts/agent-gatekeeper.js", "record-base"], { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`record-base failed:\nSTDOUT:${result.stdout}\nSTDERR:${result.stderr}`);
  return result.stdout;
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

function loadDecision(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ".agent/runtime/current-decision.json"), "utf8"));
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

function readBytes(dir, relPath) {
  return fs.readFileSync(path.join(dir, relPath));
}

function adapterFor(dir) {
  return require(path.join(dir, "scripts/agent-runtime-adapter.js"));
}

function restoreAndReconcile(dir) {
  const adapter = adapterFor(dir);
  const decision = loadDecision(dir);
  const restored = adapter.restoreIncidentalLockfileChurn(decision);
  const result = adapter.reconcileRuntimeResult(decision);
  return { restored, result };
}

function expectSucceeds(name, dir, expectedRestored, expectedChangedFiles) {
  const { restored, result } = restoreAndReconcile(dir);
  const gotRestored = [...restored].sort();
  const wantRestored = [...expectedRestored].sort();
  if (JSON.stringify(gotRestored) !== JSON.stringify(wantRestored)) {
    throw new Error(`${name}: expected restored ${JSON.stringify(wantRestored)}, got ${JSON.stringify(gotRestored)}`);
  }
  const gotChanged = [...result.changed_files].sort();
  const wantChanged = [...expectedChangedFiles].sort();
  if (JSON.stringify(gotChanged) !== JSON.stringify(wantChanged)) {
    throw new Error(`${name}: expected changed_files ${JSON.stringify(wantChanged)}, got ${JSON.stringify(gotChanged)}`);
  }
  console.log(`${name}: observed expected deterministic outcome`);
}

function expectThrows(name, dir, expectedSubstring) {
  const adapter = adapterFor(dir);
  const decision = loadDecision(dir);
  let threw = null;
  let restored = [];
  try {
    restored = adapter.restoreIncidentalLockfileChurn(decision);
    adapter.reconcileRuntimeResult(decision);
  } catch (error) {
    threw = error;
  }
  if (!threw) throw new Error(`${name}: expected reconciliation to fail closed but it succeeded`);
  if (!threw.message.includes(expectedSubstring)) {
    throw new Error(`${name}: expected error to include "${expectedSubstring}"\nGot: ${threw.message}`);
  }
  return restored;
}

// 1. RUN #31 exact style (CASE A): package-lock clean at baseline, OpenHands incidentally changes it,
//    package.json untouched, neither authorized; a legitimate allowed file also changed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "frontend/package-lock.json"), "incidental-churn\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  expectSucceeds("RUN #31 style incidental churn restored", dir, ["frontend/package-lock.json"], ["frontend/src/App.js"]);
  const bytes = readBytes(dir, "frontend/package-lock.json");
  if (bytes.toString("utf8") !== "base-lock-content\n") {
    throw new Error(`RUN #31 style: expected restored content to equal trusted base blob, got: ${bytes.toString("utf8")}`);
  }
  console.log("RUN #31 style: restored content matches exact trusted base blob");
}

// 2. Pre-existing dirty package-lock further modified by OpenHands (CASE A with pre-existing dirt).
{
  const dir = makeRepo();
  writeFile(path.join(dir, "frontend/package-lock.json"), "pre-existing-dirty-content\n");
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "frontend/package-lock.json"), "openhands-churn-content\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  expectSucceeds("pre-existing dirty lockfile further modified: restored to dirty baseline", dir, ["frontend/package-lock.json"], ["frontend/src/App.js"]);
  const bytes = readBytes(dir, "frontend/package-lock.json");
  if (bytes.toString("utf8") !== "pre-existing-dirty-content\n") {
    throw new Error(`pre-existing dirty lockfile: expected exact pre-implementation DIRTY content, got: ${bytes.toString("utf8")}`);
  }
  console.log("pre-existing dirty lockfile: restored content matches exact pre-implementation dirty bytes, not HEAD");
}

// 3. Authorized package-lock (CASE C/E): explicitly allowed -> never restored, remains in actual delta.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/package-lock.json"]);
  writeFile(path.join(dir, "frontend/package-lock.json"), "explicitly-authorized-change\n");
  writeRuntimeResult(dir, ["frontend/package-lock.json"]);
  expectSucceeds("explicitly authorized lockfile is never restored", dir, [], ["frontend/package-lock.json"]);
  const bytes = readBytes(dir, "frontend/package-lock.json");
  if (bytes.toString("utf8") !== "explicitly-authorized-change\n") {
    throw new Error("explicitly authorized lockfile: content must remain the implementation's own change");
  }
}

// 4. Authorized package.json companion (CASE B): companion semantics preserved, lockfile not restored.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/package.json"]);
  writeFile(path.join(dir, "frontend/package.json"), '{"name":"frontend","version":"2.0.0"}\n');
  writeFile(path.join(dir, "frontend/package-lock.json"), "companion-authorized-change\n");
  writeRuntimeResult(dir, ["frontend/package.json"]);
  expectSucceeds("authorized package.json companion preserves lockfile as-is", dir, [], ["frontend/package.json", "frontend/package-lock.json"]);
  const bytes = readBytes(dir, "frontend/package-lock.json");
  if (bytes.toString("utf8") !== "companion-authorized-change\n") {
    throw new Error("companion lockfile: content must remain the implementation's own change");
  }
}

// 5. Unauthorized package.json + package-lock (CASE D): genuine unauthorized delta, must NOT be restored,
//    reconciliation fails closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "frontend/package.json"), '{"name":"frontend","version":"9.9.9"}\n');
  writeFile(path.join(dir, "frontend/package-lock.json"), "unauthorized-dependency-change\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  const restored = expectThrows("unauthorized package.json+lock fails closed (CASE D)", dir, "out-of-scope path: frontend/package-lock.json");
  if (restored.length) throw new Error("CASE D: package-lock.json must not be restored when its companion package.json genuinely changed");
  const bytes = readBytes(dir, "frontend/package-lock.json");
  if (bytes.toString("utf8") !== "unauthorized-dependency-change\n") {
    throw new Error("CASE D: unauthorized lockfile content must be left untouched, not restored or altered");
  }
  console.log("CASE D: unauthorized package.json+lock fails closed: observed expected deterministic outcome");
}

// 6. Unrelated unauthorized source file (CASE F): untouched by cleanup, fails closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "backend/server.js"), "changed\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  const restored = expectThrows("unrelated unauthorized source file fails closed (CASE F)", dir, "out-of-scope path: backend/server.js");
  if (restored.length) throw new Error("CASE F: cleanup must never touch a non-lockfile path");
  console.log("CASE F: observed expected deterministic outcome");
}

// 7. Protected control-plane file (CASE G): untouched, fails closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "scripts/agent-gatekeeper.js"), `${gatekeeperSource}\n// tampered\n`);
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  const restored = expectThrows("protected control-plane file fails closed (CASE G)", dir, "protected control-plane path: scripts/agent-gatekeeper.js");
  if (restored.length) throw new Error("CASE G: cleanup must never touch a protected control-plane path");
  console.log("CASE G: observed expected deterministic outcome");
}

// 8. Forbidden/sensitive file (CASE H): untouched, fails closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "id_rsa"), "fake-key-material\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  const restored = expectThrows("forbidden sensitive file fails closed (CASE H)", dir, "forbidden secret-bearing path: id_rsa");
  if (restored.length) throw new Error("CASE H: cleanup must never touch a forbidden/sensitive path");
  console.log("CASE H: observed expected deterministic outcome");
}

// 9. Pre-existing dirty unrelated file, unchanged by OpenHands -> still excluded by baseline fingerprint
//    semantics (unaffected by this feature).
{
  const dir = makeRepo();
  writeFile(path.join(dir, "backend/notes.md"), "pre-existing draft\n");
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  expectSucceeds("pre-existing dirty unrelated file untouched stays excluded", dir, [], ["frontend/src/App.js"]);
}

// 10. Pre-existing dirty unrelated file further modified by OpenHands -> detected, fails closed.
{
  const dir = makeRepo();
  writeFile(path.join(dir, "backend/notes.md"), "pre-existing draft\n");
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "backend/notes.md"), "further modified by implementation\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  const restored = expectThrows("pre-existing dirty unrelated file further modified fails closed", dir, "out-of-scope path: backend/notes.md");
  if (restored.length) throw new Error("further-modified pre-existing unrelated file must not be restored (not a lockfile)");
  console.log("pre-existing dirty unrelated file further modified: observed expected deterministic outcome");
}

// 11. Runtime evidence files remain excluded from implementation delta.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, ".agent/runtime/trace.txt"), "ignored runtime evidence\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  expectSucceeds("runtime evidence excluded from delta", dir, [], ["frontend/src/App.js"]);
}

// 12. Model omitted a legitimate actual file -> existing reconciliation still normalizes changed_files.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js", "frontend/src/Extra.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "frontend/src/Extra.js"), "new\n");
  writeRuntimeResult(dir, ["frontend/src/App.js"]);
  expectSucceeds("model omission still normalized", dir, [], ["frontend/src/App.js", "frontend/src/Extra.js"]);
}

// 13. Model invented a file absent from actual delta -> existing reconciliation still removes it.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, ["frontend/src/App.js"]);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeRuntimeResult(dir, ["frontend/src/App.js", "frontend/src/Invented.js"]);
  expectSucceeds("model invention still dropped", dir, [], ["frontend/src/App.js"]);
}

console.log("All incidental lockfile restoration regression scenarios passed.");
