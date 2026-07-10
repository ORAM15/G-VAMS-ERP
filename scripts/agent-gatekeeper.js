#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const requiredInputs = [".agent/PROJECT_VISION.md",".agent/AUTONOMOUS_RULES.md",".agent/DEVELOPMENT_MEMORY.md",".agent/BACKLOG.md",".agent/DAILY_DECISIONS.json",".agent/generated/AGENT_CONTEXT.md",".agent/generated/AGENT_CONTEXT.json","frontend/package.json","backend/package.json"];
const protectedControlPlane = [".agent/AUTONOMOUS_RULES.md",".agent/PROJECT_VISION.md","scripts/agent-gatekeeper.js","scripts/agent-runtime-adapter.js","scripts/agent-cycle.js",".github/workflows/"];
const agentStatePaths = [".agent/DEVELOPMENT_MEMORY.md",".agent/BACKLOG.md",".agent/DAILY_DECISIONS.json",".agent/generated/AGENT_CONTEXT.md",".agent/generated/AGENT_CONTEXT.json",".agent/runtime/current-decision.json",".agent/runtime/runtime-result.json",".agent/runtime/base-state.json"];
const forbiddenPathPatterns = [/^\.env(?:\.|$)/,/^\.git(?:\/|$)/,/(^|\/)\.git-credentials$/,/(^|\/)id_rsa$/,/(^|\/)id_ed25519$/,/(^|\/).*\.(pem|key|p12|pfx)$/i,/(^|\/)(secrets?|credentials?)(\.|\/|$)/i];
const secretPatterns = [
  { category: "private-key-block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { category: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { category: "aws-access-key", regex: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { category: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { category: "mongodb-credential-uri", regex: /mongodb(?:\+srv)?:\/\/[^\s:@/]+:[^\s@/]+@/gi },
  { category: "jwt-secret-assignment", regex: /\b(?:JWT_SECRET|TOKEN_SECRET)\s*=\s*[^\s#]+/gi },
  { category: "sensitive-env-assignment", regex: /^\s*[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|GEMINI|GOOGLE_API_KEY)[A-Z0-9_]*\s*=\s*[^\s#]+/gim },
];
function rel(p) { return p.split(path.sep).join("/").replace(/^\.\//, ""); }
function abs(p) { return path.join(root, p); }
function readJson(file) { return JSON.parse(fs.readFileSync(abs(file), "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(abs(file)), { recursive: true }); fs.writeFileSync(abs(file), `${JSON.stringify(value, null, 2)}\n`); }
function fail(messages) { messages.forEach((m) => console.error(`ERROR: ${m}`)); process.exit(1); }
function ok(message) { console.log(message); }
function isForbiddenPath(p) { const n = rel(p); return forbiddenPathPatterns.some((r) => r.test(n)); }
function isProtected(p) { const n = rel(p); return protectedControlPlane.some((entry) => entry.endsWith("/") ? n.startsWith(entry) : n === entry); }
function isAgentState(p) { const n = rel(p); return agentStatePaths.includes(n); }
function isPackageLockCompanion(file, allowed) { const n = rel(file); if (path.posix.basename(n) !== "package-lock.json") return false; const manifest = path.posix.join(path.posix.dirname(n), "package.json"); return allowed.some((a) => rel(a) === manifest); }
function underAllowed(file, allowed) { const n = rel(file); return allowed.some((a) => { const x = rel(a); return n === x || n.startsWith(x.replace(/\/$/, "") + "/"); }) || isPackageLockCompanion(n, allowed); }
function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function loadConfig() { try { return readJson(".agent/runtime/config.json"); } catch { return {}; } }
function loadBaseState() { try { return readJson(".agent/runtime/base-state.json"); } catch { return null; } }
function baseSha() { return process.env.AGENT_BASE_SHA || (loadBaseState() || {}).trusted_base_sha || git(["rev-parse", "HEAD"]); }
function diffFiles(base = baseSha()) { return git(["diff", base, "--name-only"]).split("\n").filter(Boolean).map(rel); }
function normalizeRepoPath(p) { return rel(String(p || "").replace(/\\/g, "/")).replace(/^\/+/, ""); }
function isRuntimeEvidencePath(p) { return normalizeRepoPath(p).startsWith(".agent/runtime/"); }
function actualImplementationDelta(base = baseSha()) { return [...new Set([...diffFiles(base), ...untrackedFiles()].map(normalizeRepoPath).filter((f) => f && !isRuntimeEvidencePath(f)))].sort(); }
function reportedChangedFiles(r) { return [...new Set((Array.isArray(r.changed_files) ? r.changed_files : []).map(normalizeRepoPath).filter((f) => f && !isRuntimeEvidencePath(f)))].sort(); }
function validateRuntimeReportDiff(file) {
  const r = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8")); const errors = [];
  if (r.outcome === "blocked" || r.outcome === "no_safe_improvement") {
    if (Array.isArray(r.changed_files) && r.changed_files.length > 0) errors.push(`${r.outcome} result cannot claim changed files`);
    if (errors.length) fail(errors); ok(`Runtime report/diff consistency skipped for outcome=${r.outcome}; no implementation delta is accepted.`); return;
  }
  const actual = actualImplementationDelta(); const reported = reportedChangedFiles(r);
  if (!Array.isArray(r.changed_files)) errors.push("runtime-result changed_files must be an array");
  const missing = actual.filter((f) => !reported.includes(f));
  const invented = reported.filter((f) => !actual.includes(f));
  if (missing.length) errors.push(`runtime-result changed_files omitted actual repository delta file(s): ${missing.join(", ")}`);
  if (invented.length) errors.push(`runtime-result changed_files reported file(s) absent from actual repository delta: ${invented.join(", ")}`);
  if (actual.length === 0) errors.push("actual non-runtime repository delta is empty");
  if (reported.length === 0) errors.push("runtime-result changed_files is empty after normalizing ignored runtime evidence paths");
  if (errors.length) fail(errors); ok(`Runtime report/diff consistency passed: ${reported.length} changed file(s) exactly match actual non-runtime repository delta.`);
}
function diffLines(base = baseSha()) { const out = git(["diff", base, "--numstat"]); return out.split("\n").filter(Boolean).reduce((sum, line) => { const [a,b] = line.split(/\s+/); return sum + (Number(a) || 0) + (Number(b) || 0); }, 0); }
function untrackedFiles() { return git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean).map(rel); }
function recordBase() {
  const sha = git(["rev-parse", "HEAD"]), branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  writeJson(".agent/runtime/base-state.json", { schema_version: 1, trusted_base_sha: sha, trusted_base_branch: branch, recorded_at: new Date().toISOString() });
  ok(`Recorded trusted base SHA ${sha} on ${branch}.`);
}
function validateLineage() {
  const state = loadBaseState(); if (!state) return ["missing .agent/runtime/base-state.json; base SHA was not recorded"];
  const errors = [];
  try { git(["merge-base", "--is-ancestor", state.trusted_base_sha, "HEAD"]); } catch { errors.push("HEAD is not descended from trusted base SHA; history rewrite or branch lineage violation suspected"); }
  const mergeCommits = git(["rev-list", "--min-parents=2", `${state.trusted_base_sha}..HEAD`]).split("\n").filter(Boolean);
  if (mergeCommits.length > 0) errors.push("merge commits are not allowed in autonomous runtime delta");
  return errors;
}
function validateValidationCommand(command) {
  if (typeof command !== "string" || command.length > 160) return "validation command must be a short string";
  if (/[;&|`$<>]/.test(command) || /\b(curl|wget|nc|ssh|scp|git\s+credential|npm\s+publish|rm\s+-rf)\b/.test(command)) return "validation command contains forbidden shell syntax or network/destructive command";
  const parts = command.trim().split(/\s+/);
  const allowed = [
    ["node", "--check", /^scripts\/[A-Za-z0-9._/-]+\.js$/],
    ["npm", "--prefix", /^(frontend|backend)$/, "run", /^(build|test|lint)$/],
    ["npm", "--prefix", /^(frontend|backend)$/, "test"],
  ];
  return allowed.some((shape) => shape.length === parts.length && shape.every((s, i) => s instanceof RegExp ? s.test(parts[i]) : s === parts[i])) ? null : "validation command is not in the deterministic allowlist";
}
function trustedBaseConfiguredScript(command) {
  const match = command.match(
    /^npm --prefix (frontend|backend) run (build|test|lint)$/
  );
  if (!match) return null;

  const [, workspace, script] = match;
  const manifest = `${workspace}/package.json`;

  let pkg;
  try {
    pkg = JSON.parse(
      git(["show", `${baseSha()}:${manifest}`])
    );
  } catch {
    return {
      workspace,
      script,
      configured: false,
      reason: `trusted base does not contain ${manifest}`,
    };
  }

  const configured = Boolean(
    pkg.scripts &&
    typeof pkg.scripts[script] === "string" &&
    pkg.scripts[script].trim()
  );

  return {
    workspace,
    script,
    configured,
    reason: configured
      ? `trusted base configures npm script '${script}'`
      : `trusted base does not configure npm script '${script}'`,
  };
}
function runValidation(commands) {
  return commands.map((item) => {
    const command = typeof item === "string" ? item : item.command;
    const policyError = validateValidationCommand(command);
    if (policyError) return { command, exit_code: 127, outcome: "failed", summary: policyError };
  if (item && typeof item === "object" && item.skip === true) {
  const baseScript = trustedBaseConfiguredScript(command);

  if (baseScript && baseScript.configured) {
    return {
      command,
      exit_code: 1,
      outcome: "failed",
      summary:
        `${baseScript.workspace}/package.json removed npm script ` +
        `'${baseScript.script}' that existed at trusted base ${baseSha()}; ` +
        "refusing to disable planned validation",
    };
  }

  return {
    command,
    exit_code: 0,
    outcome: "not_configured",
    summary:
      baseScript
        ? baseScript.reason
        : item.skip_reason ||
          "repository does not configure this validation script",
  };
}
    const parts = command.trim().split(/\s+/);
    const result = spawnSync(parts[0], parts.slice(1), { cwd: root, encoding: "utf8", shell: false, stdio: "inherit" });
    const exit = result.status === null ? 1 : result.status;
    return { command, exit_code: exit, outcome: exit === 0 ? "passed" : "failed", summary: "independently executed by deterministic orchestrator" };
  });
}
function validateInput() {
  const errors = [];
  for (const file of requiredInputs) if (!fs.existsSync(abs(file)) || fs.statSync(abs(file)).size === 0) errors.push(`required trusted input missing or empty: ${file}`);
  for (const file of [".agent/DAILY_DECISIONS.json", ".agent/generated/AGENT_CONTEXT.json", "frontend/package.json", "backend/package.json", ".agent/runtime/config.json"]) if (fs.existsSync(abs(file))) { try { readJson(file); } catch (e) { errors.push(`invalid JSON in ${file}: ${e.message}`); } }
  for (const file of [".agent/generated/AGENT_CONTEXT.md", ".agent/generated/AGENT_CONTEXT.json", ".agent/runtime/current-decision.json", ".agent/runtime/runtime-result.json"].filter((f) => fs.existsSync(abs(f)))) {
    const text = fs.readFileSync(abs(file), "utf8");
    for (const pattern of secretPatterns) { pattern.regex.lastIndex = 0; let match; while ((match = pattern.regex.exec(text)) !== null) errors.push(`secret-like material detected: file=${file} category=${pattern.category} line=${text.slice(0, match.index).split("\n").length}`); }
  }
  if (errors.length) fail(errors); ok("Input gate passed: trusted files are present, parseable, and generated context/runtime artifacts passed secret scan.");
}
function validateDecision(file) {
  const d = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8")); const errors = [];
  for (const k of ["cycle_id","selected_improvement","selection_reason","declared_scope","allowed_paths","planned_validation","risk_level"]) if (d[k] === undefined || d[k] === null || d[k] === "" || (Array.isArray(d[k]) && d[k].length === 0)) errors.push(`decision missing required non-empty field: ${k}`);
  if (!d.selected_backlog_id && !d.repository_observed_improvement) errors.push("decision must declare selected_backlog_id or repository_observed_improvement");
  if (!/^[A-Za-z0-9._:-]{3,}$/.test(d.cycle_id || "")) errors.push("cycle_id must be stable and non-empty");
  if (!["low","medium","high"].includes(d.risk_level)) errors.push("risk_level must be one of low, medium, high");
  for (const p of d.allowed_paths || []) { if (isForbiddenPath(p)) errors.push(`decision attempts to authorize forbidden path: ${p}`); if (isProtected(p)) errors.push(`decision attempts to authorize protected control-plane path: ${p}`); }
  for (const v of d.planned_validation || []) { const err = validateValidationCommand(typeof v === "string" ? v : v.command); if (err) errors.push(`planned validation rejected: ${err}`); }
  if (errors.length) fail(errors); ok(`Decision gate passed for ${d.cycle_id}: exactly one declared improvement is scoped.`);
}
function validateDiff(file) {
  const d = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8")); const config = loadConfig(); const thresholds = config.diff_thresholds || {}; const maxFiles = Number(process.env.AGENT_MAX_CHANGED_FILES || thresholds.max_changed_files || 12); const maxLines = Number(process.env.AGENT_MAX_LINE_CHANGES || thresholds.max_line_changes || 500); const base = baseSha();
  const files = [...new Set([...diffFiles(base), ...untrackedFiles()])]; const lines = diffLines(base); const errors = validateLineage();
  if (files.length === 0) errors.push("diff is empty"); if (files.length > maxFiles) errors.push(`changed file threshold exceeded: ${files.length} > ${maxFiles}`); if (lines > maxLines) errors.push(`line-change threshold exceeded: ${lines} > ${maxLines}`);
  for (const f of files) { if (isForbiddenPath(f)) errors.push(`diff changed forbidden secret-bearing path: ${f}`); if (isProtected(f)) errors.push(`diff changed protected control-plane path: ${f}`); if (!isAgentState(f) && !underAllowed(f, d.allowed_paths || [])) errors.push(`diff changed out-of-scope path: ${f}`); }
  if (/^[-+].*(npm test|node --check|validation|validate)/mi.test(git(["diff", base]))) console.warn("WARNING: validation-related lines changed; human review required.");
  if (errors.length) fail(errors); ok(`Diff gate passed against ${base}: ${files.length} file(s), ${lines} changed line(s), all within approved scope or agent state.`);
}
function normalizeResult(file) {
  const resultFile = rel(path.relative(root, path.resolve(root, file)));
  const validationFile = ".agent/runtime/validation-results.json";
  if (!fs.existsSync(abs(validationFile))) throw new Error("deterministic validation results are missing; refusing to trust model-reported validation");
  const r = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8"));
  const observed = readJson(validationFile);
  if (!Array.isArray(observed) || observed.length === 0) throw new Error("deterministic validation results are empty; refusing to normalize runtime result");
  r.validation = observed;
  if (observed.some((v) => v.outcome === "failed" || Number(v.exit_code) !== 0) && r.outcome === "success") r.outcome = "failed";
  writeJson(resultFile, r);
  return r;
}
function validateResult(file) {
  const r = normalizeResult(file); const errors = [];
  for (const k of ["cycle_id","runtime","implementation_summary","changed_files","validation","outcome","known_limitations","recommended_next_direction"]) if (r[k] === undefined || r[k] === null || r[k] === "" || (Array.isArray(r[k]) && k !== "changed_files" && r[k].length === 0)) errors.push(`result missing required field: ${k}`);
  if (!["success","failed","blocked","no_safe_improvement"].includes(r.outcome)) errors.push("result outcome is outside strict enum");
  if ((r.validation || []).some((v) => v.outcome === "failed" || Number(v.exit_code) !== 0) && r.outcome === "success") errors.push("failed validation cannot be represented as success");
  if (r.outcome === "success" && (!Array.isArray(r.changed_files) || r.changed_files.length === 0)) errors.push("success result cannot have an empty changed_files list");
  if (r.outcome === "success" || r.outcome === "failed") { try { validateRuntimeReportDiff(file); } catch (e) { errors.push(e.message); } }
  if (r.outcome === "blocked" && Array.isArray(r.changed_files) && r.changed_files.length > 0) errors.push("blocked result cannot claim changed files");
  if (r.outcome === "blocked" && !/capacity|provider|rate.?limit|exhaust/i.test(`${r.implementation_summary} ${r.known_limitations} ${r.recommended_next_direction}`)) errors.push("blocked result must carry explicit provider-capacity evidence");
  if (errors.length) fail(errors); ok(`Result gate passed for ${r.cycle_id} with outcome=${r.outcome}; validation normalized from deterministic observations.`);
}
const [stage, file] = process.argv.slice(2);
try {
  if (stage === "record-base") recordBase();
  else if (stage === "input") validateInput();
  else if (stage === "decision" && file) validateDecision(file);
  else if (stage === "diff" && file) validateDiff(file);
  else if (stage === "result" && file) validateResult(file);
  else if (stage === "result-diff" && file) validateRuntimeReportDiff(file);
  else if (stage === "validation-policy" && file) { const err = validateValidationCommand(file); if (err) fail([err]); ok("Validation command accepted by policy."); }
  else if (stage === "run-validation" && file) writeJson(".agent/runtime/validation-results.json", runValidation(readJson(file)));
  else fail(["usage: node scripts/agent-gatekeeper.js <record-base|input|decision|diff|result|result-diff|validation-policy|run-validation> [artifact|command]"]);
} catch (e) { fail([e.message]); }
