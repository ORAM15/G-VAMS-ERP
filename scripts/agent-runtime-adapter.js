#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const runtimeDir = path.join(root, ".agent", "runtime");
const resultPath = path.join(runtimeDir, "runtime-result.json");
const decisionPath = path.join(runtimeDir, "current-decision.json");
const taskPath = (stage) => path.join(runtimeDir, `${stage}-task.txt`);
const outputPath = (stage) => path.join(runtimeDir, `${stage}-openhands.jsonl`);
function readConfig() { return JSON.parse(fs.readFileSync(path.join(runtimeDir, "config.json"), "utf8")); }
function cycleId() { return process.env.AGENT_CYCLE_ID || `AE-${new Date().toISOString().slice(0, 10)}-001`; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function gitPaths(args) { return git(args).split("\n").filter(Boolean); }
function configValue(config, key, envKey) { return process.env[envKey] || config[key] || null; }
function disabled(stage, config) {
  writeJson(resultPath, { cycle_id: cycleId(), runtime: "disabled", model_provider: config.provider || null, model: config.model || null, decision_artifact: fs.existsSync(decisionPath) ? ".agent/runtime/current-decision.json" : null, implementation_summary: `Runtime adapter is disabled during ${stage}; no coding-agent execution occurred.`, changed_files: [], validation: [{ command: `node scripts/agent-runtime-adapter.js ${stage}`, exit_code: 0, outcome: "skipped", summary: "No runtime is connected." }], outcome: "blocked", known_limitations: "Runtime mode remains disabled until a human-supervised OpenHands activation is explicitly configured.", recommended_next_direction: "Configure GEMINI_API_KEY, AGENT_LLM_MODEL, and AGENT_RUNTIME_MODE=openhands for one manual supervised workflow_dispatch cycle." });
  console.log("Agent runtime mode is disabled. No coding-agent runtime is connected; wrote blocked runtime result.");
}
function writeTask(stage, config) {
  const template = fs.readFileSync(path.join(runtimeDir, "agent-task-template.md"), "utf8");
  const base = JSON.parse(fs.readFileSync(path.join(runtimeDir, "base-state.json"), "utf8"));
  const prefix = `${template}\n\nCycle: ${cycleId()}\nTrusted base SHA: ${base.trusted_base_sha}\n`;
  if (stage === "decision") {
    fs.writeFileSync(taskPath(stage), `${prefix}\nDECISION-ONLY STAGE\nRead only trusted context and choose exactly one focused improvement. Create .agent/runtime/current-decision.json using .agent/schemas/decision.schema.json. Do not implement. Do not modify application code. Do not stage files. Do not commit. Stop after writing the decision artifact.\n`);
  } else {
    const decision = fs.readFileSync(decisionPath, "utf8");
    fs.writeFileSync(taskPath(stage), `${prefix}\nIMPLEMENTATION STAGE\nApproved decision artifact:\n${decision}\nImplement only this approved improvement. Modify only allowed_paths. Do not modify protected control-plane files or workflows. Do not stage files. Do not commit. Run relevant validation only if safe. Write .agent/runtime/runtime-result.json using .agent/schemas/runtime-result.schema.json, then stop.\n`);
  }
}
function requireOpenHandsConfig(config) {
  const runtimeVersion = configValue(config, "runtime_version", "AGENT_RUNTIME_VERSION");
  const model = configValue(config, "model", "AGENT_LLM_MODEL");
  if (!runtimeVersion) throw new Error("runtime_mode=openhands requires pinned runtime_version");
  if (!model) throw new Error("runtime_mode=openhands requires AGENT_LLM_MODEL or config.model");
  if (!process.env.GEMINI_API_KEY) throw new Error("runtime_mode=openhands requires GEMINI_API_KEY secret");
  if (!/^gemini\/[A-Za-z0-9._-]+$/.test(model)) throw new Error("AGENT_LLM_MODEL must use the verified LiteLLM Gemini format, for example gemini/gemini-2.0-flash");
  return { runtimeVersion, model };
}
function openhands(stage, config) {
  const { runtimeVersion, model } = requireOpenHandsConfig(config);
  writeTask(stage, config);
  const version = spawnSync("openhands", ["--version"], { cwd: root, encoding: "utf8", shell: false });
  if (version.status !== 0 || !(`${version.stdout}${version.stderr}`).includes(runtimeVersion)) throw new Error(`Installed OpenHands version does not match pinned ${runtimeVersion}`);
  const env = { ...process.env, LLM_MODEL: model, LLM_API_KEY: process.env.GEMINI_API_KEY };
  const out = fs.openSync(outputPath(stage), "w");
  const result = spawnSync("openhands", ["--override-with-envs", "--headless", "--json", "-f", taskPath(stage)], { cwd: root, env, shell: false, stdio: ["ignore", out, "pipe"], encoding: "utf8" });
  fs.closeSync(out);
  if (result.stderr) process.stderr.write(result.stderr.replace(process.env.GEMINI_API_KEY, "[REDACTED]"));
  if (stage === "decision") {
    const base = JSON.parse(fs.readFileSync(path.join(runtimeDir, "base-state.json"), "utf8")).trusted_base_sha;
    const tracked = gitPaths(["diff", base, "--name-only"]);
    const untracked = gitPaths(["ls-files", "--others", "--exclude-standard"]);
    const allowedDecisionArtifacts = new Set([
      ".agent/runtime/current-decision.json",
      ".agent/runtime/decision-task.txt",
      ".agent/runtime/decision-openhands.jsonl"
    ]);
    const changed = [...new Set([...tracked, ...untracked])].filter((f) => !f.startsWith(".agent/generated/") && !allowedDecisionArtifacts.has(f));
    if (changed.length) throw new Error(`Decision stage modified files before approval: ${changed.join(", ")}`);
  }
  if (result.status !== 0) {
    writeJson(resultPath, { cycle_id: cycleId(), runtime: "openhands", runtime_version: runtimeVersion, model_provider: "gemini", model, decision_artifact: fs.existsSync(decisionPath) ? ".agent/runtime/current-decision.json" : null, implementation_summary: `OpenHands ${stage} stage exited non-zero.`, changed_files: [], validation: [{ command: `openhands --override-with-envs --headless --json -f .agent/runtime/${stage}-task.txt`, exit_code: result.status || 1, outcome: "failed", summary: "OpenHands process failed; stderr was not committed." }], outcome: "failed", known_limitations: "OpenHands execution failed before deterministic success gates.", recommended_next_direction: "Inspect sanitized workflow artifacts and rerun manually after correcting configuration." });
    process.exit(1);
  }
  console.log(`OpenHands ${stage} stage completed with pinned version ${runtimeVersion}.`);
}
function main() {
  const stage = process.argv[2] || "decision";
  if (!["decision", "implementation", "cycle"].includes(stage)) { console.error("usage: node scripts/agent-runtime-adapter.js <decision|implementation|cycle>"); process.exit(1); }
  const config = readConfig();
  const mode = process.env.AGENT_RUNTIME_MODE || config.runtime_mode || "disabled";
  if (mode === "disabled") return disabled(stage, config);
  if (mode === "openhands") return openhands(stage, config);
  console.error(`Unsupported or unverified runtime_mode=${mode}. Failing closed.`); process.exit(2);
}
try { main(); } catch (e) { console.error(`ERROR: ${e.message}`); process.exit(1); }
