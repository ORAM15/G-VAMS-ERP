#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const gatekeeper = require("./agent-gatekeeper.js");

const root = path.resolve(__dirname, "..");
const runtimeDir = path.join(root, ".agent", "runtime");
const resultPath = path.join(runtimeDir, "runtime-result.json");
const decisionPath = path.join(runtimeDir, "current-decision.json");
const taskPath = (stage) => path.join(runtimeDir, `${stage}-task.txt`);
const outputPath = (stage) => path.join(runtimeDir, `${stage}-openhands.jsonl`);
// The narrative fields Result Gate requires (scripts/agent-gatekeeper.js validateResult()) that only the
// model itself can truthfully supply -- there is no deterministic execution metadata to derive them from.
const REQUIRED_NARRATIVE_FIELDS = ["implementation_summary", "known_limitations", "recommended_next_direction"];
function readConfig() { return JSON.parse(fs.readFileSync(path.join(runtimeDir, "config.json"), "utf8")); }
function cycleId() { return process.env.AGENT_CYCLE_ID || `AE-${new Date().toISOString().slice(0, 10)}-001`; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function gitPaths(args) { return git(args).split("\n").filter(Boolean); }
function configValue(config, key, envKey) { return process.env[envKey] || config[key] || null; }
function disabled(stage, config) {
  writeJson(resultPath, { cycle_id: cycleId(), runtime: "disabled", model_provider: config.provider || null, model: config.model || null, decision_artifact: fs.existsSync(decisionPath) ? ".agent/runtime/current-decision.json" : null, implementation_summary: `Runtime adapter is disabled during ${stage}; no coding-agent execution occurred.`, changed_files: [], validation: [{ command: `node scripts/agent-runtime-adapter.js ${stage}`, exit_code: 0, outcome: "skipped", summary: "No runtime is connected." }], outcome: "blocked", known_limitations: "Runtime mode remains disabled until a human-supervised OpenHands activation is explicitly configured.", recommended_next_direction: "Configure GEMINI_API_KEY, AGENT_LLM_MODEL, an approved implementation provider key, AGENT_IMPLEMENTATION_MODEL, and AGENT_RUNTIME_MODE=openhands for one manual supervised workflow_dispatch cycle." });
  console.log("Agent runtime mode is disabled. No coding-agent runtime is connected; wrote blocked runtime result.");
}
function writeTask(stage) {
  const template = fs.readFileSync(path.join(runtimeDir, "agent-task-template.md"), "utf8");
  const base = JSON.parse(fs.readFileSync(path.join(runtimeDir, "base-state.json"), "utf8"));
  const config = readConfig();
  const maxLines = Number(process.env.AGENT_MAX_LINE_CHANGES || config.diff_thresholds?.max_line_changes || 500);
  const prefix = `${template}\n\nCycle: ${cycleId()}\nTrusted base SHA: ${base.trusted_base_sha}\n`;
  if (stage === "implementation") {
    const decision = fs.readFileSync(decisionPath, "utf8");
    const deltaBudget = `\nHARD DELTA BUDGET\nThe deterministic Diff Gate permits at most ${maxLines} total added plus deleted lines from the trusted base. Treat this as a hard safety ceiling, not a target. Implement the smallest viable patch and preserve existing formatting. Do not rewrite whole files, reformat unrelated code, regenerate assets, or modify lockfiles/generated files unless the approved decision explicitly requires them. Before reporting success, inspect git diff --numstat and keep the total safely below ${maxLines}. If the approved improvement cannot be completed within this budget, do not force a broad patch: write runtime-result.json with outcome=blocked, explain the limitation, and stop.\n`;
    fs.writeFileSync(taskPath(stage), `${prefix}${deltaBudget}\nIMPLEMENTATION STAGE\nApproved decision artifact:\n${decision}\nImplement only this approved improvement. Modify only allowed_paths. Do not modify protected control-plane files or workflows. Do not stage files. Do not commit. Run relevant validation only if safe. Write .agent/runtime/runtime-result.json using .agent/schemas/runtime-result.schema.json, then stop.\n`);
  }
}
function requireGemini(config) {
  const model = configValue(config, "model", "AGENT_LLM_MODEL");
  if (!model) throw new Error("AGENT_LLM_MODEL or config.model is required");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY secret is required");
  if (!/^gemini\/[A-Za-z0-9._-]+$/.test(model)) throw new Error("AGENT_LLM_MODEL must use gemini/<model-name>");
  return model;
}
function implementationCandidate(model) {
  const match = model.match(/^(openrouter|gemini)\/[A-Za-z0-9._\/-]+$/);
  if (!match) throw new Error(`Implementation model must use an approved openrouter/<model-name> or gemini/<model-name> identifier: ${model}`);
  const provider = match[1];
  const apiKey = provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return { model, provider, apiKey };
}
function requireOpenHandsConfig(config) {
  const runtimeVersion = configValue(config, "runtime_version", "AGENT_RUNTIME_VERSION");
  const configured = process.env.AGENT_IMPLEMENTATION_MODELS || process.env.AGENT_IMPLEMENTATION_MODEL || null;
  if (!runtimeVersion) throw new Error("runtime_mode=openhands requires pinned runtime_version");
  if (!configured) throw new Error("AGENT_IMPLEMENTATION_MODELS or AGENT_IMPLEMENTATION_MODEL is required for the OpenHands implementation stage");
  const models = configured.split(",").map((model) => model.trim()).filter(Boolean);
  const candidates = models.map(implementationCandidate).filter(Boolean);
  if (!candidates.length) throw new Error("No approved implementation candidate has its required provider secret configured");
  return { runtimeVersion, candidates };
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
  const validationContract = `planned_validation MUST be an array of plain strings. Every string MUST exactly match one of these deterministic command shapes:\n- node --check scripts/<path>.js\n- npm --prefix frontend run build\n- npm --prefix frontend run test\n- npm --prefix frontend run lint\n- npm --prefix backend run build\n- npm --prefix backend run test\n- npm --prefix backend run lint\n- npm --prefix frontend test\n- npm --prefix backend test\nDo not use objects in planned_validation. Do not add flags, shell operators, cd, npx, curl, git, or any other validation command. Choose only commands relevant to the selected improvement.`;
  const prompt = `You are the supervised decision brain for G-VAMS. Use ONLY the trusted repository context below. Choose exactly one focused, low-risk improvement. Return ONLY one JSON object matching the supplied schema. cycle_id must be ${cycleId()}. Do not include markdown. Do not implement code.\n\nSTRICT DETERMINISTIC VALIDATION CONTRACT:\n${validationContract}\n\nDECISION SCHEMA:\n${schema}\n\nTRUSTED CONTEXT:${trustedDecisionContext()}`;
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
function writeRuntimeFailure(stage, runtimeVersion, model, provider, status, summary, limitation) {
  writeJson(resultPath, { cycle_id: cycleId(), runtime: "openhands", runtime_version: runtimeVersion, model_provider: provider, model, decision_artifact: fs.existsSync(decisionPath) ? ".agent/runtime/current-decision.json" : null, implementation_summary: summary, changed_files: [], validation: [{ command: `openhands --override-with-envs --headless --json -f .agent/runtime/${stage}-task.txt`, exit_code: status || 1, outcome: "failed", summary: limitation }], outcome: "failed", known_limitations: limitation, recommended_next_direction: "Inspect the runtime JSONL artifact and correct the provider or agent output contract before rerunning the supervised cycle." });
}
function writeProviderCapacityBlock(stage, runtimeVersion, attempts) {
  const last = attempts[attempts.length - 1];
  const limitation = attempts.map((attempt) => `${attempt.model}: ${attempt.limitation}`).join(" | ");
  writeJson(resultPath, { cycle_id: cycleId(), runtime: "openhands", runtime_version: runtimeVersion, model_provider: last.provider, model: last.model, decision_artifact: fs.existsSync(decisionPath) ? ".agent/runtime/current-decision.json" : null, implementation_summary: "Implementation was not completed because every configured implementation provider candidate had no trustworthy execution capacity.", changed_files: [], validation: [{ command: `openhands --override-with-envs --headless --json -f .agent/runtime/${stage}-task.txt`, exit_code: 1, outcome: "failed", summary: limitation }], outcome: "blocked", known_limitations: limitation, recommended_next_direction: "Restore capacity for at least one approved implementation candidate or configure another approved candidate, then start a fresh supervised cycle from the trusted base." });
}
function classifyOpenHandsEvidence(stage, provider) {
  const artifact = outputPath(stage);
  if (!fs.existsSync(artifact)) return null;
  const evidence = fs.readFileSync(artifact, "utf8");
  if (/free-models-per-day|X-RateLimit-Remaining[^\n]*\\?"0\\?"|RateLimitError|OpenrouterException[\s\S]*code\\?"?:\\?"?429|RESOURCE_EXHAUSTED|quota[^\n]*exceed|rate.?limit[^\n]*429|currently experiencing high demand|status\\?"?:\\?"?UNAVAILABLE/i.test(evidence)) {
    return `${provider} implementation capacity was exhausted, unavailable, or rate-limited; OpenHands did not produce trustworthy successful implementation evidence.`;
  }
  return null;
}
function writeReconciliationFailure(stage, runtimeVersion, model, provider, reason) {
  writeJson(resultPath, { cycle_id: cycleId(), runtime: "openhands", runtime_version: runtimeVersion, model_provider: provider, model, decision_artifact: fs.existsSync(decisionPath) ? ".agent/runtime/current-decision.json" : null, implementation_summary: "OpenHands executed successfully but its runtime report could not be deterministically reconciled with the authorized implementation scope.", changed_files: [], validation: [{ command: `openhands --override-with-envs --headless --json -f .agent/runtime/${stage}-task.txt`, exit_code: 1, outcome: "failed", summary: reason }], outcome: "failed", known_limitations: reason, recommended_next_direction: "Inspect the actual repository delta against the approved decision's allowed_paths, narrow scope or implementation accordingly, and rerun from a fresh trusted base." });
}
// lockfilePreimplementationContent proves the exact pre-implementation bytes of a package-lock.json path,
// or returns null if no such proof exists (in which case restoration must be refused, never guessed).
// - If the path was already dirty at record-base time, its exact pre-implementation content only exists in
//   the snapshot captured then (a fingerprint cannot be reversed into content); a missing snapshot means no
//   proof is available even though the path is marked dirty.
// - If the path was clean at record-base time (not in preexisting_delta_files), its pre-implementation
//   content is whatever is committed at the trusted base SHA, if anything -- a lockfile that appeared out of
//   nowhere with no prior committed or captured state has no provable "restore to" target.
function lockfilePreimplementationContent(fileRel, baseState) {
  const snapshotRel = baseState.preexisting_lockfile_snapshots && baseState.preexisting_lockfile_snapshots[fileRel];
  if (snapshotRel) {
    const snapshotAbs = path.join(root, snapshotRel);
    if (!fs.existsSync(snapshotAbs)) return null;
    return fs.readFileSync(snapshotAbs);
  }
  if (fileRel in (baseState.preexisting_delta_files || {})) return null;
  try {
    return execFileSync("git", ["show", `${baseState.trusted_base_sha}:${fileRel}`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}
// restoreIncidentalLockfileChurn runs after OpenHands exits successfully but before reconcileRuntimeResult()
// performs authoritative scope reconciliation. package tooling invoked by the implementation environment can
// incidentally rewrite a package-lock.json even when the approved improvement never intended a dependency
// change (Run #31). This function restores ONLY a package-lock.json path that satisfies every one of:
//   1. it is part of the actual post-implementation delta (a real change happened after baseline);
//   2. it is NOT already authorized under the exact same policy scopeViolations()/underAllowed() enforce
//      everywhere else -- an explicitly allowed lockfile, or one legitimately authorized via the existing
//      package-lock companion policy, is left completely untouched (CASE B/C/E: nothing to restore, it is
//      not a violation);
//   3. its companion package.json in the same directory did NOT change after baseline -- a real dependency-
//      manifest change, authorized or not, is never masked this way (CASE D stays a genuine unauthorized
//      delta and fails closed);
//   4. its exact pre-implementation content can be proven (see lockfilePreimplementationContent) -- absent
//      proof, the path is left alone and falls through to fail closed like any other unauthorized change.
// This never touches non-lockfile paths, so unrelated out-of-scope files (CASE F), protected control-plane
// files (CASE G), and forbidden/sensitive paths (CASE H) are always left for scopeViolations() to reject.
// It does not duplicate the authoritative git delta computation or the scope policy: both are reused as-is
// from gatekeeper.js. Restoration is logged explicitly; nothing is hidden.
function restoreIncidentalLockfileChurn(decision) {
  const baseState = gatekeeper.loadBaseState();
  if (!baseState) return [];
  const actual = gatekeeper.actualImplementationDelta();
  const actualSet = new Set(actual);
  const allowedPaths = decision.allowed_paths || [];
  const restored = [];
  for (const f of actual) {
    if (!gatekeeper.isPackageLockPath(f)) continue;
    if (gatekeeper.scopeViolations([f], allowedPaths).length === 0) continue;
    if (actualSet.has(gatekeeper.packageLockManifestPath(f))) continue;
    const content = lockfilePreimplementationContent(f, baseState);
    if (content === null) continue;
    fs.writeFileSync(path.join(root, f), content);
    restored.push(f);
    console.log(`Restored incidental unauthorized lockfile churn to pre-implementation state: ${f}`);
  }
  return restored;
}
// reconcileRuntimeResult runs after OpenHands exits successfully but before the implementation stage
// returns. The model-authored .agent/runtime/runtime-result.json is untrusted evidence: it may omit real
// changes (as happened with frontend/package-lock.json) or invent ones. This function replaces
// changed_files with the authoritative gatekeeper.actualImplementationDelta() computation, but ONLY after
// checking every actual delta path against the approved decision's allowed_paths using the exact same
// authorization policy the Diff Gate enforces (forbidden paths, protected control-plane paths, agent-state
// paths, and the existing package-lock companion policy). An actual change never becomes authorized simply
// because the model reported it, and scope violations throw instead of being silently dropped or added.
// This does not replace the independent Implementation Evidence Gate / result-diff check that runs after
// the implementation stage returns; it only prepares trustworthy evidence for that gate to verify.
//
// Run #37: a model-authored "success" report reached Result Gate missing runtime, implementation_summary,
// known_limitations, and recommended_next_direction -- reconciliation only ever rewrote changed_files, so
// that incompleteness silently survived all the way to Result Gate instead of being caught here, where the
// canonical contract can actually be enforced or the run can be failed closed before further gates run.
// This is now the single deterministic boundary that canonicalizes every producer's "success" report:
// - `runtime` is always overwritten with the orchestration layer's own ground truth ("openhands"); this
//   function only ever runs from openhandsImplementation(), so that value is never in doubt and a model is
//   never trusted to assert or override it.
// - implementation_summary / known_limitations / recommended_next_direction are truthful narrative content
//   only the model itself can supply -- there is no deterministic execution metadata to derive them from.
//   If OpenHands's own report omits any of them (or leaves one blank/non-string), this fails closed here
//   with a clear reason rather than letting an incomplete "success" reach Result Gate, and rather than
//   fabricating placeholder text.
function reconcileRuntimeResult(decision) {
  if (!fs.existsSync(resultPath)) throw new Error("OpenHands completed but did not produce .agent/runtime/runtime-result.json");
  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch (error) {
    throw new Error(`runtime-result.json is not valid JSON: ${error.message}`);
  }
  if (result.outcome !== "success") return result;
  result.runtime = "openhands";
  const resolvedDecision = decision || validateDecisionArtifact();
  const actual = gatekeeper.actualImplementationDelta();
  if (actual.length === 0) throw new Error("implementation reported success but the actual non-runtime repository delta is empty");
  const violations = gatekeeper.scopeViolations(actual, resolvedDecision.allowed_paths || []);
  if (violations.length) throw new Error(`actual implementation delta contains unauthorized path(s) not covered by the approved decision scope: ${violations.join("; ")}`);
  const missingNarrative = REQUIRED_NARRATIVE_FIELDS.filter((key) => typeof result[key] !== "string" || !result[key].trim());
  if (missingNarrative.length) throw new Error(`implementation reported success but is missing required narrative field(s): ${missingNarrative.join(", ")}`);
  result.changed_files = actual;
  writeJson(resultPath, result);
  console.log(`Reconciled runtime-result.json changed_files with the authoritative actual implementation delta (${actual.length} file(s)): ${actual.join(", ")}`);
  return result;
}
function openhandsImplementation(config) {
  const stage = "implementation";
  const { runtimeVersion, candidates } = requireOpenHandsConfig(config);
  writeTask(stage);
  const version = spawnSync("openhands", ["--version"], { cwd: root, encoding: "utf8", shell: false });
  if (version.status !== 0 || !(`${version.stdout}${version.stderr}`).includes(runtimeVersion)) throw new Error(`Installed OpenHands version does not match pinned ${runtimeVersion}`);
  const attempts = [];
  for (const { model, provider, apiKey } of candidates) {
    console.log(`Attempting OpenHands implementation with approved candidate ${provider}:${model}.`);
    const env = { ...process.env, LLM_MODEL: model, LLM_API_KEY: apiKey };
    const out = fs.openSync(outputPath(stage), "w");
    const result = spawnSync("openhands", ["--override-with-envs", "--headless", "--json", "-f", taskPath(stage)], { cwd: root, env, shell: false, stdio: ["ignore", out, "pipe"], encoding: "utf8" });
    fs.closeSync(out);
    if (result.stderr) process.stderr.write(result.stderr.replaceAll(apiKey, "[REDACTED]"));
    if (result.status !== 0) { writeRuntimeFailure(stage, runtimeVersion, model, provider, result.status, "OpenHands implementation stage exited non-zero.", "OpenHands process failed; stderr was not committed."); process.exit(1); }
    const evidenceFailure = classifyOpenHandsEvidence(stage, provider);
    if (evidenceFailure) {
      attempts.push({ model, provider, limitation: evidenceFailure });
      console.error(`CAPACITY FALLBACK: ${evidenceFailure}`);
      continue;
    }
    console.log(`OpenHands implementation stage completed with pinned version ${runtimeVersion} using ${provider} model ${model}.`);
    try {
      const decision = validateDecisionArtifact();
      const restored = restoreIncidentalLockfileChurn(decision);
      if (restored.length) console.log(`Incidental lockfile restoration complete before reconciliation: ${restored.join(", ")}`);
      reconcileRuntimeResult(decision);
    } catch (error) {
      writeReconciliationFailure(stage, runtimeVersion, model, provider, error.message);
      console.error(`RECONCILE FAILED: ${error.message}`);
      process.exit(1);
    }
    return;
  }
  writeProviderCapacityBlock(stage, runtimeVersion, attempts);
  console.error(`BLOCKED: all ${attempts.length} approved implementation candidates were capacity-limited or unavailable.`);
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
if (require.main === module) {
  main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
module.exports = { reconcileRuntimeResult, restoreIncidentalLockfileChurn };
