#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const gatekeeperSource = fs.readFileSync(path.join(repoRoot, "scripts/agent-gatekeeper.js"), "utf8");

function run(cmd, args, cwd, options = {}) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: options.stdio || ["ignore", "pipe", "pipe"] }).trim();
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-report-diff-"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "scripts/agent-gatekeeper.js"), gatekeeperSource);
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.email", "test@example.com"], dir);
  run("git", ["config", "user.name", "Test User"], dir);
  fs.mkdirSync(path.join(dir, "frontend/src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "frontend/src/App.js"), "base\n");
  run("git", ["add", "."], dir);
  run("git", ["commit", "-q", "-m", "base"], dir);
  return { dir, base: run("git", ["rev-parse", "HEAD"], dir) };
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

function check(name, changedFiles, expectedStatus, expectedText, options = {}) {
  const { outcome = "success", makeDelta = true } = options;
  const { dir, base } = makeRepo();
  if (makeDelta) {
    fs.writeFileSync(path.join(dir, "frontend/src/App.js"), "changed\n");
    fs.writeFileSync(path.join(dir, "frontend/package-lock.json"), "{}\n");
  }
  fs.mkdirSync(path.join(dir, ".agent/runtime"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".agent/runtime/trace.txt"), "ignored runtime evidence\n");
  runtimeResult(dir, changedFiles, outcome);
  const result = spawnSync("node", ["scripts/agent-gatekeeper.js", "result-diff", ".agent/runtime/runtime-result.json"], {
    cwd: dir,
    env: { ...process.env, AGENT_BASE_SHA: base },
    encoding: "utf8"
  });
  if (result.status !== expectedStatus) {
    throw new Error(`${name}: expected status ${expectedStatus}, got ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedText)) {
    throw new Error(`${name}: expected output to include ${expectedText}\n${output}`);
  }
  console.log(`${name}: observed expected deterministic outcome`);
}

check("exact match", ["./frontend/src/App.js", "frontend/package-lock.json"], 0, "exactly match actual non-runtime repository delta");
check("omitted actual file", ["frontend/src/App.js"], 1, "omitted actual repository delta file(s): frontend/package-lock.json");
check("invented reported file", ["frontend/src/App.js", "frontend/package-lock.json", "frontend/src/Invented.js"], 1, "reported file(s) absent from actual repository delta: frontend/src/Invented.js");
check("invented runtime evidence", ["frontend/src/App.js", "frontend/package-lock.json", ".agent/runtime/invented.txt"], 1, "reported file(s) absent from actual repository delta: .agent/runtime/invented.txt");

check("blocked with real non-runtime delta", [], 1, "blocked result cannot leave actual non-runtime repository delta file(s)", { outcome: "blocked" });
check("no_safe_improvement with real non-runtime delta", [], 1, "no_safe_improvement result cannot leave actual non-runtime repository delta file(s)", { outcome: "no_safe_improvement" });
check("blocked with only runtime evidence", [], 0, "Runtime report/diff consistency passed for outcome=blocked", { outcome: "blocked", makeDelta: false });
check("no_safe_improvement with only runtime evidence", [], 0, "Runtime report/diff consistency passed for outcome=no_safe_improvement", { outcome: "no_safe_improvement", makeDelta: false });
