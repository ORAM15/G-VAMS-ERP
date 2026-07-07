#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runtimeDir = path.join(root, ".agent", "runtime");
const resultPath = path.join(runtimeDir, "runtime-result.json");
const decisionPath = path.join(runtimeDir, "current-decision.json");

function readConfig() {
  const configPath = path.join(runtimeDir, "config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}
function cycleId() {
  const day = new Date().toISOString().slice(0, 10);
  return `AE-${day}-001`;
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function disabled(stage, config) {
  const result = {
    cycle_id: process.env.AGENT_CYCLE_ID || cycleId(),
    runtime: "disabled",
    model_provider: config.provider || null,
    model: config.model || null,
    decision_artifact: fs.existsSync(decisionPath) ? ".agent/runtime/current-decision.json" : null,
    implementation_summary: `Runtime adapter is disabled during ${stage}; no coding-agent execution occurred.`,
    changed_files: [],
    validation: [
      { command: "node scripts/agent-runtime-adapter.js " + stage, exit_code: 0, outcome: "skipped", summary: "No runtime is connected." }
    ],
    outcome: "blocked",
    known_limitations: "Phase 2A intentionally fails closed until a verified OpenHands unattended invocation and Gemini model configuration are connected.",
    recommended_next_direction: "Phase 2B should verify and pin the OpenHands invocation, configure Gemini through secrets/variables, and enable staged decision plus implementation execution."
  };
  writeJson(resultPath, result);
  console.log("Agent runtime mode is disabled. No coding-agent runtime is connected; wrote blocked runtime result.");
}

function main() {
  const stage = process.argv[2] || "decision";
  if (!["decision", "implementation", "cycle"].includes(stage)) {
    console.error("usage: node scripts/agent-runtime-adapter.js <decision|implementation|cycle>");
    process.exit(1);
  }
  const config = readConfig();
  if (config.runtime_mode === "disabled") return disabled(stage, config);
  console.error(`Unsupported or unverified runtime_mode=${config.runtime_mode}. Failing closed.`);
  process.exit(2);
}

main();
