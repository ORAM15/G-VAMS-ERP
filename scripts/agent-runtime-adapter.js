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
function writeTask(stage) {
  const template = fs.readFileSync(path.join(runtimeDir, "agent-task-template.md"), "utf8");
  const base = JSON.parse(fs.readFileSync(path.join(runtimeDir, "base-state.json"), "utf8"));
  const prefix = `${template}\n\nCycle: ${cycleId()}\nTrusted base SHA: ${base.trusted_base_sha}\n`;
  if (stage === "implementation") {
    const decision = fs.readFileSync(decisionPath, "utf8");
    fs.writeFileSync(taskPath(stage), `${prefix}\nIMPLEMENTATION STAGE\nApproved decision artifact:\n${decision}\nImplement only this approved improvement. Modify only allowed_paths. Do not modify protected control-plane files or workflows. Do not stage files. Do not commit. Run relevant validation only if safe. Write .agent/runtime/runtime-result.json using .agent/schemas/runtime-result.schema.json, then stop.\n`);
  }
}
function requireGemini(config) {
  const model = configValue(config, "model", "AGENT_LLM_MODEL");
  if (!model) throw new Error("AGENT_LLM_MODEL or config.model is required");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY secret is required");
  if (!/^gemini\/[A-Za-z0-9._-]+$/.test(model)) throw new Error("AGENT_LLM_MODEL must use gemini/<model-name>");
  return model;
}
function requireOpenHandsConfig(config) {
  const runtimeVersion = configValue(config, "runtime_version", "AGENT_RUNTIME_VERSION");
  const model = requireGemini(config);
  if (!runtimeVersion) throw new Error("runtime_mode=openhands requires pinned runtime_version");
  return { runtimeVersion, model };
}
function validateDecisionArtifact() {
  if (!fs.existsSync(decisionPath)) throw new Error("Decision runtime did not create required .agent/runtime/current-decision.json");
  let decision;
  try { decision = JSON.parse(fs.readFileSync(decisionPath, "utf8")); } catch (error) { throw new Error(`Decision artifact is not valid JSON: ${error.message}`); }
  const schema = JSON.parse(fs.readFileSync(path.join(root, ".agent", "schemas", "decision.schema.json"), "utf8"));
  const missing = schema.required.filter((key) => !(key in decision));
  if (missing.length) throw new Error(`Decision artifact is missing required fields: ${missing.join(", ")}`);
  if (!Array.isArray(decision.allowed_paths) || decision.allowed_paths.length === 0) throw new Error("Decision artifact allowed_paths must be a non-empty array");
  if (!Array.isArray(decision.planned_validation) || decision.planned_validation.length === 0) throw new Error("Decision artifact planned_validation must be a non-empty array");
  if (!schema.properties.risk_level.enum.includes(decision.risk_level)) throw new Error(`Decision artifact risk_level is invalid: ${decision.risk_level}`);
  if (!decision.selected_backlog_id && !decision.repository_observed_improvement) throw new Error("Decision artifact must identify a backlog item or repository-observed improvement");
  return decision;
}
function trustedDecisionContext() {
  const files = [".agent/PROJECT_VISION.md", ".agent/AUTONOMOUS_RULES.md", ".agent/DEVELOPMENT_MEMORY.md", ".agent/BACKLOG.md", ".agent/DAILY_DECISIONS.json", ".agent/generated/AGENT_CONTEXT.md", "docs/PROJECT_HEALTH.md"];
  return files.map((file) => `\n--- ${file} ---\n${fs.readFileSync(path.join(root, file), "utf8")}`).join("\n");
}
async function directGeminiDecision(config) {
  const configuredModel = requireGemini(config);
  const model = configuredModel.replace(/^gemini\//, "");
  const schema = fs.readFileSync(path.join(root, ".agent", "schemas", "decision.schema.json"), "utf8");
  const prompt = `You are the supervised decision brain for G-VAMS. Use ONLY the trusted repository context below. Choose exactly one focused, low-risk improvement. Return ONLY one JSON object matching the supplied schema. cycle_id must be ${cycleId()}. Do not include markdown. Do not implement code.\n\nDECISION SCHEMA:\n${schema}\n\nTRUSTED CONTEXT:${trustedDecisionContext()}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }) });
  if (!response.ok) { const body = await response.text(); throw new Error(`Direct Gemini decision request failed HTTP ${response.status}: ${body.slice(0, 500)}`); }
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Direct Gemini decision response contained no text candidate");
  let decision;
  try { decision = JSON.parse(text); } catch (error) { throw new Error(`Direct Gemini decision response was not JSON: ${error.message}`); }
  writeJson(decisionPath, decision);
  validateDecisionArtifact();
  console.log(`Direct Gemini decision stage completed with model ${model}; decision artifact validated.`);
}
function writeRuntimeFailure(stage, runtimeVersion, model, status, summary, limitation) {
  writeJson(resultPath, { cycle_id: cycleId(), runtime: "openhands", runtime_version: runtimeVersion, model_provider: "gemini", model, decision_artifact: fs.existsSync(decisionPath) ? ".agent/runtime/current-decision.json" : null, implementation_summary: summary, changed_files: [], validation: [{ command: `openhands --override-with-envs --headless --json -f .agent/runtime/${stage}-task.txt`, exit_code: status || 1, outcome: "failed", summary: limitation }], outcome: "failed", known_limitations: limitation, recommended_next_direction: "Inspect the runtime JSONL artifact and correct the agent output contract before rerunning the supervised cycle." });
}
function openhandsImplementation(config) {
  const stage = "implementation";
  const { runtimeVersion, model } = requireOpenHandsConfig(config);
  writeTask(stage);
  const version = spawnSync("openhands", ["--version"], { cwd: root, encoding: "utf8", shell: false });
  if (version.status !== 0 || !(`${version.stdout}${version.stderr}`).includes(runtimeVersion)) throw new Error(`Installed OpenHands version does not match pinned ${runtimeVersion}`);
  const env = { ...process.env, LLM_MODEL: model, LLM_API_KEY: process.env.GEMINI_API_KEY };
  const out = fs.openSync(outputPath(stage), "w");
  const result = spawnSync("openhands", ["--override-with-envs", "--headless", "--json", "-f", taskPath(stage)], { cwd: root, env, shell: false, stdio: ["ignore", out, "pipe"], encoding: "utf8" });
  fs.closeSync(out);
  if (result.stderr) process.stderr.write(result.stderr.replace(process.env.GEMINI_API_KEY, "[REDACTED]"));
  if (result.status !== 0) { writeRuntimeFailure(stage, runtimeVersion, model, result.status, "OpenHands implementation stage exited non-zero.", "OpenHands process failed; stderr was not committed."); process.exit(1); }
  console.log(`OpenHands implementation stage completed with pinned version ${runtimeVersion}.`);
}
async function main() {
  const stage = process.argv[2] || "decision";
  if (!["decision", "implementation", "cycle"].includes(stage)) { console.error("usage: node scripts/agent-runtime-adapter.js <decision|implementation|cycle>"); process.exit(1); }
  const config = readConfig();
  const mode = process.env.AGENT_RUNTIME_MODE || config.runtime_mode || "disabled";
  if (mode === "disabled") return disabled(stage, config);
  if (mode !== "openhands") throw new Error(`Unsupported or unverified runtime_mode=${mode}. Failing closed.`);
  if (stage === "decision") return directGeminiDecision(config);
  if (stage === "implementation") return openhandsImplementation(config);
  await directGeminiDecision(config);
  return openhandsImplementation(config);
}
main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
