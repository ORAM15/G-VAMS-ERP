#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const gatekeeperSource = fs.readFileSync(path.join(repoRoot, "scripts/agent-gatekeeper.js"), "utf8");

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-baseline-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/agent-gatekeeper.js"), gatekeeperSource);
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.email", "test@example.com"], dir);
  run("git", ["config", "user.name", "Test User"], dir);
  writeFile(path.join(dir, "frontend/src/App.js"), "base\n");
  writeFile(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), '{"v":1}\n');
  run("git", ["add", "."], dir);
  run("git", ["commit", "-q", "-m", "base"], dir);
  return dir;
}

function recordBase(dir) {
  const result = spawnSync("node", ["scripts/agent-gatekeeper.js", "record-base"], { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`record-base failed:\nSTDOUT:${result.stdout}\nSTDERR:${result.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(dir, ".agent/runtime/base-state.json"), "utf8"));
}

function runtimeResult(dir, changedFiles, outcome = "success") {
  writeJson(path.join(dir, ".agent/runtime/runtime-result.json"), {
    cycle_id: "test-cycle",
    runtime: "test",
    implementation_summary: "test",
    changed_files: changedFiles,
    validation: [{ command: "node --check scripts/agent-gatekeeper.js", exit_code: 0, outcome: "passed" }],
    outcome,
    known_limitations: "none",
    recommended_next_direction: "none"
  });
}

function resultDiff(dir) {
  return spawnSync("node", ["scripts/agent-gatekeeper.js", "result-diff", ".agent/runtime/runtime-result.json"], { cwd: dir, encoding: "utf8" });
}

function expect(name, dir, expectedStatus, expectedText) {
  const result = resultDiff(dir);
  if (result.status !== expectedStatus) {
    throw new Error(`${name}: expected status ${expectedStatus}, got ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedText)) {
    throw new Error(`${name}: expected output to include "${expectedText}"\n${output}`);
  }
  console.log(`${name}: observed expected deterministic outcome`);
}

// 1. Clean pre-runtime baseline + implementation changes one file -> included.
{
  const dir = makeRepo();
  const state = recordBase(dir);
  if (Object.keys(state.preexisting_delta_files).length !== 0) {
    throw new Error("clean baseline: expected no pre-existing delta files to be recorded");
  }
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  runtimeResult(dir, ["frontend/src/App.js"]);
  expect("clean baseline: implementation delta detected", dir, 0, "exactly match actual non-runtime repository delta");
}

// 2. Pre-runtime generated context already modified, OpenHands does not touch it, another file changes
//    -> generated context excluded, implementation file included.
{
  const dir = makeRepo();
  writeFile(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), '{"v":2,"regenerated":true}\n');
  const state = recordBase(dir);
  if (!state.preexisting_delta_files[".agent/generated/AGENT_CONTEXT.json"]) {
    throw new Error("expected baseline to capture pre-existing dirty generated context fingerprint");
  }
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  runtimeResult(dir, ["frontend/src/App.js"]);
  expect("untouched pre-existing generated context excluded", dir, 0, "exactly match actual non-runtime repository delta");

  // Reporting the untouched pre-existing file would now be an invented entry.
  runtimeResult(dir, ["frontend/src/App.js", ".agent/generated/AGENT_CONTEXT.json"]);
  expect("reporting untouched pre-existing file as changed fails closed", dir, 1, "reported file(s) absent from actual repository delta: .agent/generated/AGENT_CONTEXT.json");
}

// 3. Pre-runtime generated context already modified, OpenHands modifies that same file again
//    -> it MUST be detected as implementation delta.
{
  const dir = makeRepo();
  writeFile(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), '{"v":2,"regenerated":true}\n');
  recordBase(dir);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), '{"v":3,"touchedByOpenHands":true}\n');
  runtimeResult(dir, ["frontend/src/App.js", ".agent/generated/AGENT_CONTEXT.json"]);
  expect("further-modified pre-existing file detected when reported", dir, 0, "exactly match actual non-runtime repository delta");

  runtimeResult(dir, ["frontend/src/App.js"]);
  expect("omitting a further-modified pre-existing file fails closed", dir, 1, "omitted actual repository delta file(s): .agent/generated/AGENT_CONTEXT.json");
}

// 4. frontend/package-lock.json appears only after implementation -> it MUST be detected as implementation delta.
{
  const dir = makeRepo();
  recordBase(dir);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "frontend/package-lock.json"), "{}\n");
  runtimeResult(dir, ["frontend/src/App.js", "frontend/package-lock.json"]);
  expect("new package-lock.json after baseline is detected", dir, 0, "exactly match actual non-runtime repository delta");

  runtimeResult(dir, ["frontend/src/App.js"]);
  expect("omitting new package-lock.json fails closed", dir, 1, "omitted actual repository delta file(s): frontend/package-lock.json");
}

// 5. Exact runtime report match passes (already exercised above; add an explicit baseline + dirty-context case).
{
  const dir = makeRepo();
  writeFile(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), '{"v":2,"regenerated":true}\n');
  recordBase(dir);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, "frontend/package-lock.json"), "{}\n");
  runtimeResult(dir, ["frontend/src/App.js", "frontend/package-lock.json"]);
  expect("exact match with pre-existing dirty context present", dir, 0, "exactly match actual non-runtime repository delta");
}

// 6. Runtime report omits a real post-baseline implementation file -> fails closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  runtimeResult(dir, []);
  expect("empty report against real post-baseline delta fails closed", dir, 1, "omitted actual repository delta file(s): frontend/src/App.js");
}

// 7. Runtime report invents a file -> fails closed.
{
  const dir = makeRepo();
  recordBase(dir);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  runtimeResult(dir, ["frontend/src/App.js", "frontend/src/Invented.js"]);
  expect("invented file fails closed", dir, 1, "reported file(s) absent from actual repository delta: frontend/src/Invented.js");
}

// 8. blocked/no_safe_improvement with a genuine post-baseline repository delta -> fails closed.
//    Also confirm blocked/no_safe_improvement with ONLY pre-existing untouched dirty files (the real-world
//    false positive this fix targets) is accepted.
{
  const dir = makeRepo();
  writeFile(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), '{"v":2,"regenerated":true}\n');
  recordBase(dir);

  // Only pre-existing, untouched dirty context remains -> blocked/no_safe_improvement must be accepted.
  runtimeResult(dir, [], "blocked");
  expect("blocked with only pre-existing untouched delta passes", dir, 0, "Runtime report/diff consistency passed for outcome=blocked");
  runtimeResult(dir, [], "no_safe_improvement");
  expect("no_safe_improvement with only pre-existing untouched delta passes", dir, 0, "Runtime report/diff consistency passed for outcome=no_safe_improvement");

  // A genuine new post-baseline change must still fail closed for blocked/no_safe_improvement.
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  runtimeResult(dir, [], "blocked");
  expect("blocked with genuine post-baseline delta fails closed", dir, 1, "blocked result cannot leave actual non-runtime repository delta file(s): frontend/src/App.js");
  runtimeResult(dir, [], "no_safe_improvement");
  expect("no_safe_improvement with genuine post-baseline delta fails closed", dir, 1, "no_safe_improvement result cannot leave actual non-runtime repository delta file(s): frontend/src/App.js");
}

// 9. Runtime evidence under .agent/runtime/ remains excluded according to the existing contract.
{
  const dir = makeRepo();
  writeFile(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), '{"v":2,"regenerated":true}\n');
  recordBase(dir);
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  writeFile(path.join(dir, ".agent/runtime/trace.txt"), "ignored runtime evidence\n");
  writeFile(path.join(dir, ".agent/runtime/invented.txt"), "also ignored if reported\n");
  runtimeResult(dir, ["frontend/src/App.js"]);
  expect("runtime evidence paths excluded from actual delta", dir, 0, "exactly match actual non-runtime repository delta");

  runtimeResult(dir, ["frontend/src/App.js", ".agent/runtime/invented.txt"]);
  expect("reporting a runtime evidence path as changed is invented", dir, 1, "reported file(s) absent from actual repository delta: .agent/runtime/invented.txt");
}

console.log("All pre-implementation baseline regression scenarios passed.");
