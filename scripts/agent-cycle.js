#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const runtimeDir = path.join(root, ".agent", "runtime");
const resultFile = path.join(runtimeDir, "runtime-result.json");
const decisionFile = path.join(runtimeDir, "current-decision.json");
function run(command, args, options = {}) { console.log(`$ ${[command, ...args].join(" ")}`); const r = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "inherit", shell: false, ...options }); return r.status === null ? 1 : r.status; }
function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function changedFiles(base) { return git(["diff", base, "--name-only"]).split("\n").filter(Boolean); }
function untracked() { return git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean); }
function appendMemory(result) { fs.appendFileSync(path.join(root, ".agent", "DEVELOPMENT_MEMORY.md"), ["", `## ${result.cycle_id} — ${result.outcome}`, "", `- Runtime: ${result.runtime}`, `- Summary: ${result.implementation_summary}`, `- Limitations: ${result.known_limitations}`, `- Next direction: ${result.recommended_next_direction}`, ""].join("\n")); }
function updateDecisions(result) { const file = path.join(root, ".agent", "DAILY_DECISIONS.json"); const data = readJson(file); if (!Array.isArray(data.cycles)) data.cycles = []; data.cycles.push({ cycle_id: result.cycle_id, timestamp: new Date().toISOString(), runtime: result.runtime, outcome: result.outcome, implementation_summary: result.implementation_summary, changed_files: result.changed_files, validation: result.validation, known_limitations: result.known_limitations, recommended_next_direction: result.recommended_next_direction }); writeJson(file, data); }
function main() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  if (run("node", ["scripts/agent-gatekeeper.js", "record-base"]) !== 0) process.exit(1);
  const base = readJson(path.join(runtimeDir, "base-state.json")).trusted_base_sha;
  if (run("node", ["scripts/autonomous-agent-context.js"]) !== 0) process.exit(1);
  if (run("node", ["scripts/agent-gatekeeper.js", "input"]) !== 0) process.exit(1);
  if (run("node", ["scripts/agent-runtime-adapter.js", "decision"]) !== 0) process.exit(1);
  const result = fs.existsSync(resultFile) ? readJson(resultFile) : null;
  if (!fs.existsSync(decisionFile)) {
    if (result && run("node", ["scripts/agent-gatekeeper.js", "result", ".agent/runtime/runtime-result.json"]) === 0) { console.log("Agent cycle blocked before decision artifact; no implementation was attempted."); return; }
    console.error("Runtime did not produce a decision artifact or blocked result. Failing closed."); process.exit(1);
  }
  const premature = changedFiles(base).filter((f) => !f.startsWith(".agent/generated/") && f !== ".agent/runtime/current-decision.json" && f !== ".agent/runtime/base-state.json");
  if (premature.length) { console.error(`Decision stage made premature implementation changes: ${premature.join(", ")}`); process.exit(1); }
  if (run("node", ["scripts/agent-gatekeeper.js", "decision", ".agent/runtime/current-decision.json"]) !== 0) process.exit(1);
  if (run("node", ["scripts/agent-runtime-adapter.js", "implementation"]) !== 0) process.exit(1);
  if (run("node", ["scripts/agent-gatekeeper.js", "diff", ".agent/runtime/current-decision.json"]) !== 0) process.exit(1);
  let finalResult = readJson(resultFile);
  const decision = readJson(decisionFile);
  const validations = [];
  for (const item of decision.planned_validation || []) validations.push(typeof item === "string" ? item : item.command);
  if (validations.length) {
    const tmp = path.join(runtimeDir, "planned-validation.json"); writeJson(tmp, validations);
    if (run("node", ["scripts/agent-gatekeeper.js", "run-validation", ".agent/runtime/planned-validation.json"]) !== 0) process.exit(1);
    const actual = readJson(path.join(runtimeDir, "validation-results.json"));
    finalResult.validation = actual;
    if (actual.some((v) => Number(v.exit_code) !== 0 || v.outcome !== "passed")) finalResult.outcome = "failed";
  }
  finalResult.changed_files = [...new Set([...changedFiles(base), ...untracked()])].filter((f) => !f.startsWith(".agent/runtime/"));
  writeJson(resultFile, finalResult);
  if (run("node", ["scripts/agent-gatekeeper.js", "result", ".agent/runtime/runtime-result.json"]) !== 0) process.exit(1);
  if (finalResult.outcome === "success") { updateDecisions(finalResult); appendMemory(finalResult); console.log("Successful cycle state updated; workflow owns isolated branch push and PR creation."); }
  else console.log(`Cycle ended with outcome=${finalResult.outcome}; persistent success state was not updated.`);
}
main();
