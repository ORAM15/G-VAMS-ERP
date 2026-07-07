#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const runtimeDir = path.join(root, ".agent", "runtime");
const resultFile = path.join(runtimeDir, "runtime-result.json");
const decisionFile = path.join(runtimeDir, "current-decision.json");

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "inherit", ...options });
  return result.status === null ? 1 : result.status;
}
function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function changedFiles() { return git(["diff", "--name-only"]).split("\n").filter(Boolean); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function appendMemory(result) {
  const memory = path.join(root, ".agent", "DEVELOPMENT_MEMORY.md");
  const lines = [
    "",
    `## ${result.cycle_id} — ${result.outcome}`,
    "",
    `- Runtime: ${result.runtime}`,
    `- Summary: ${result.implementation_summary}`,
    `- Limitations: ${result.known_limitations}`,
    `- Next direction: ${result.recommended_next_direction}`,
    ""
  ];
  fs.appendFileSync(memory, lines.join("\n"));
}
function updateDecisions(result) {
  const file = path.join(root, ".agent", "DAILY_DECISIONS.json");
  const data = readJson(file);
  if (!Array.isArray(data.cycles)) data.cycles = [];
  data.cycles.push({
    cycle_id: result.cycle_id,
    timestamp: new Date().toISOString(),
    runtime: result.runtime,
    outcome: result.outcome,
    implementation_summary: result.implementation_summary,
    changed_files: result.changed_files,
    validation: result.validation,
    known_limitations: result.known_limitations,
    recommended_next_direction: result.recommended_next_direction
  });
  writeJson(file, data);
}

function main() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const originalDiff = changedFiles();
  if (run("node", ["scripts/autonomous-agent-context.js"]) !== 0) process.exit(1);
  if (run("node", ["scripts/agent-gatekeeper.js", "input"]) !== 0) process.exit(1);
  if (run("node", ["scripts/agent-runtime-adapter.js", "decision"]) !== 0) process.exit(1);

  const result = fs.existsSync(resultFile) ? readJson(resultFile) : null;
  if (!fs.existsSync(decisionFile)) {
    if (result) {
      if (run("node", ["scripts/agent-gatekeeper.js", "result", ".agent/runtime/runtime-result.json"]) !== 0) process.exit(1);
      console.log("Agent cycle blocked before decision artifact; no implementation was attempted.");
      return;
    }
    console.error("Runtime did not produce a decision artifact or blocked result. Failing closed.");
    process.exit(1);
  }

  if (run("node", ["scripts/agent-gatekeeper.js", "decision", ".agent/runtime/current-decision.json"]) !== 0) process.exit(1);
  if (run("node", ["scripts/agent-runtime-adapter.js", "implementation"]) !== 0) process.exit(1);
  if (run("node", ["scripts/agent-gatekeeper.js", "diff", ".agent/runtime/current-decision.json"]) !== 0) process.exit(1);

  const finalResult = readJson(resultFile);
  const validationFailed = (finalResult.validation || []).some((item) => Number(item.exit_code) !== 0 || item.outcome === "failed");
  if (validationFailed && finalResult.outcome === "success") {
    console.error("Validation failed but result claimed success. Failing closed.");
    process.exit(1);
  }
  if (run("node", ["scripts/agent-gatekeeper.js", "result", ".agent/runtime/runtime-result.json"]) !== 0) process.exit(1);
  if (finalResult.outcome === "success") {
    updateDecisions(finalResult);
    appendMemory(finalResult);
    console.log("Successful cycle state updated. Branch/PR creation is reserved for a verified runtime path.");
  } else {
    console.log(`Cycle ended with outcome=${finalResult.outcome}; persistent state was not updated beyond runtime artifacts.`);
  }
  const newDiff = changedFiles().filter((file) => !originalDiff.includes(file));
  if (finalResult.outcome !== "success" && newDiff.some((file) => !file.startsWith(".agent/generated/") && !file.startsWith(".agent/runtime/"))) {
    console.error("Blocked/failed cycle left unexpected non-generated changes. Failing closed.");
    process.exit(1);
  }
}

main();
