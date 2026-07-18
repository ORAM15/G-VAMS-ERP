#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const requiredInputs = [".agent/PROJECT_VISION.md",".agent/AUTONOMOUS_RULES.md",".agent/DEVELOPMENT_MEMORY.md",".agent/BACKLOG.md",".agent/DAILY_DECISIONS.json",".agent/generated/AGENT_CONTEXT.md",".agent/generated/AGENT_CONTEXT.json","frontend/package.json","backend/package.json"];
const protectedControlPlane = [".agent/AUTONOMOUS_RULES.md",".agent/PROJECT_VISION.md","scripts/agent-gatekeeper.js","scripts/agent-runtime-adapter.js","scripts/agent-cycle.js","scripts/agent-branch-publish.js","scripts/agent-backlog-reconcile.js",".github/workflows/"];
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
function isPackageLockPath(p) { return path.posix.basename(rel(p)) === "package-lock.json"; }
function packageLockManifestPath(p) { const n = rel(p); return path.posix.join(path.posix.dirname(n), "package.json"); }
function isPackageLockCompanion(file, allowed) { const n = rel(file); if (!isPackageLockPath(n)) return false; return allowed.some((a) => rel(a) === packageLockManifestPath(n)); }
function underAllowed(file, allowed) { const n = rel(file); return allowed.some((a) => { const x = rel(a); return n === x || n.startsWith(x.replace(/\/$/, "") + "/"); }) || isPackageLockCompanion(n, allowed); }
function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function loadConfig() { try { return readJson(".agent/runtime/config.json"); } catch { return {}; } }
function loadBaseState() { try { return readJson(".agent/runtime/base-state.json"); } catch { return null; } }
function baseSha() { return process.env.AGENT_BASE_SHA || (loadBaseState() || {}).trusted_base_sha || git(["rev-parse", "HEAD"]); }
function diffFiles(base = baseSha()) { return git(["diff", base, "--name-only"]).split("\n").filter(Boolean).map(rel); }
function normalizeRepoPath(p) { return rel(String(p || "").replace(/\\/g, "/")).replace(/^\/+/, ""); }
function isRuntimeEvidencePath(p) { return normalizeRepoPath(p).startsWith(".agent/runtime/"); }
function fileFingerprint(p) { try { return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(abs(p))).digest("hex")}`; } catch { return "absent"; } }
function currentNonRuntimeDelta(base = baseSha()) { return [...new Set([...diffFiles(base), ...untrackedFiles()])].map(normalizeRepoPath).filter((f) => f && !isRuntimeEvidencePath(f)); }
// actualImplementationDelta represents files newly introduced or further changed by the implementation
// runtime, i.e. the post-implementation non-runtime delta MINUS whatever was already dirty relative to
// trusted_base_sha before implementation began (see recordBase). A pre-existing dirty path is only
// excluded while its content fingerprint still matches the one captured at record-base time; any further
// modification (including deletion) changes the fingerprint and is therefore still reported. If no
// baseline was recorded, or the requested base does not match the recorded trusted base, nothing is
// excluded, preserving the original fail-closed behavior.
function actualImplementationDelta(base = baseSha()) {
  const current = currentNonRuntimeDelta(base);
  const state = loadBaseState();
  const baseline = state && state.trusted_base_sha === base && state.preexisting_delta_files && typeof state.preexisting_delta_files === "object" ? state.preexisting_delta_files : {};
  return current.filter((f) => !(f in baseline) || fileFingerprint(f) !== baseline[f]).sort();
}
function reportedChangedFiles(r) { return [...new Set((Array.isArray(r.changed_files) ? r.changed_files : []).map(normalizeRepoPath).filter(Boolean))].sort(); }
function validateRuntimeReportDiff(file) {
  const r = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8")); const errors = [];
  const actual = actualImplementationDelta();
  if (r.outcome === "blocked" || r.outcome === "no_safe_improvement") {
    if (Array.isArray(r.changed_files) && r.changed_files.length > 0) errors.push(`${r.outcome} result cannot claim changed files`);
    if (actual.length > 0) errors.push(`${r.outcome} result cannot leave actual non-runtime repository delta file(s): ${actual.join(", ")}`);
    if (errors.length) fail(errors); ok(`Runtime report/diff consistency passed for outcome=${r.outcome}; no non-runtime implementation delta exists.`); return;
  }
  const reported = reportedChangedFiles(r);
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
  // Capture a fingerprint of every non-runtime path that is already dirty relative to `sha` right now,
  // before the implementation runtime starts (e.g. deterministic context regeneration that ran just
  // before this step). actualImplementationDelta() later subtracts only the paths whose fingerprint is
  // still unchanged, so a pre-existing dirty file that the runtime further modifies (or deletes) remains
  // detectable as implementation delta.
  const preexisting = currentNonRuntimeDelta(sha).sort();
  const preexisting_delta_files = Object.fromEntries(preexisting.map((f) => [f, fileFingerprint(f)]));
  // A fingerprint alone cannot reconstruct content, so for any pre-existing dirty package-lock.json we also
  // snapshot its exact current bytes under .agent/runtime/ (already excluded from implementation delta by
  // isRuntimeEvidencePath). This lets a later "restore incidental unauthorized lockfile churn" step put a
  // lockfile back to its true pre-implementation state -- including pre-existing dirty content -- rather
  // than ever falling back to the trusted base SHA's committed version for a file that was already dirty.
  const preexisting_lockfile_snapshots = {};
  for (const f of preexisting) {
    if (!isPackageLockPath(f)) continue;
    try {
      const content = fs.readFileSync(abs(f));
      const snapshotRel = `.agent/runtime/lockfile-baseline/${Buffer.from(f, "utf8").toString("base64url")}.snapshot`;
      fs.mkdirSync(path.dirname(abs(snapshotRel)), { recursive: true });
      fs.writeFileSync(abs(snapshotRel), content);
      preexisting_lockfile_snapshots[f] = snapshotRel;
    } catch {
      // Unreadable at the moment of capture (e.g. removed between listing and read); no snapshot is
      // possible, so restoration will later refuse to guess and leave the file as unauthorized delta.
    }
  }
  writeJson(".agent/runtime/base-state.json", { schema_version: 3, trusted_base_sha: sha, trusted_base_branch: branch, preexisting_delta_files, preexisting_lockfile_snapshots, recorded_at: new Date().toISOString() });
  const snapshotCount = Object.keys(preexisting_lockfile_snapshots).length;
  ok(`Recorded trusted base SHA ${sha} on ${branch} with ${preexisting.length} pre-existing non-runtime delta file(s)${preexisting.length ? `: ${preexisting.join(", ")}` : ""}${snapshotCount ? ` (captured ${snapshotCount} pre-existing lockfile snapshot(s) for incidental-churn restoration)` : ""}.`);
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
  if (d.selected_backlog_id) {
    let backlogText = null;
    try { backlogText = fs.readFileSync(abs(".agent/BACKLOG.md"), "utf8"); } catch { /* no backlog file to check against */ }
    if (backlogText && backlogStatuses(backlogText)[d.selected_backlog_id] === "done") {
      errors.push(`decision selected backlog item ${d.selected_backlog_id} which .agent/BACKLOG.md already records as done; completed backlog items cannot be re-selected`);
    }
  }
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
  errors.push(...backlogCompletionTampering(base));
  if (/^[-+].*(npm test|node --check|validation|validate)/mi.test(git(["diff", base]))) console.warn("WARNING: validation-related lines changed; human review required.");
  if (errors.length) fail(errors); ok(`Diff gate passed against ${base}: ${files.length} file(s), ${lines} changed line(s), all within approved scope or agent state.`);
}
// scopeViolations checks each of `files` against the exact same authorization policy validateDiff() uses
// (forbidden secret-bearing paths, protected control-plane paths, agent-state paths, and allowed_paths
// including the existing package-lock companion policy inside underAllowed()) without exposing those
// individual policy primitives. Returns a human-readable violation message per failing check (a single
// path can produce more than one violation); an empty array means every path is authorized.
function scopeViolations(files, allowedPaths) {
  const allowed = Array.isArray(allowedPaths) ? allowedPaths : [];
  const violations = [];
  for (const f of files) {
    if (isForbiddenPath(f)) violations.push(`forbidden secret-bearing path: ${f}`);
    if (isProtected(f)) violations.push(`protected control-plane path: ${f}`);
    if (!isAgentState(f) && !underAllowed(f, allowed)) violations.push(`out-of-scope path: ${f}`);
  }
  return violations;
}
// parseBacklogItems extracts each "### AE-BL-XXX" item block from .agent/BACKLOG.md text and its declared
// Status value (the file's own documented convention: open, in-progress, blocked, done, rejected). This is
// the single parser reused by the Decision Gate (reject re-selection of completed work), the Diff Gate
// (reject an implementation delta that flips completion state itself), generated context, and the
// deterministic post-merge backlog reconciliation script -- never duplicated.
function parseBacklogItems(text) {
  const items = [];
  const headingRe = /^### (AE-BL-[A-Za-z0-9-]+)\s*$/gm;
  const matches = [...text.matchAll(headingRe)];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const block = text.slice(start, end);
    const statusMatch = block.match(/^-\s*\*\*Status:\*\*\s*(\S+)\s*$/m);
    items.push({ id: matches[i][1], status: statusMatch ? statusMatch[1] : null, start, end });
  }
  return items;
}
function backlogStatuses(text) {
  return Object.fromEntries(parseBacklogItems(text).map((item) => [item.id, item.status]));
}
// backlogCompletionTampering fails closed if an implementation delta changes .agent/BACKLOG.md so that
// completion state moves in either forbidden direction. Only the deterministic post-merge
// scripts/agent-backlog-reconcile.js may ever establish or hold completion state -- never the implementation
// runtime/model -- even though BACKLOG.md is otherwise permitted agent state (see agentStatePaths) so
// legitimate non-completion edits to the file remain unaffected. Two symmetric checks:
//   1. non-done -> done: an item cannot be self-declared complete by the implementation itself.
//   2. done -> anything else (including disappearing entirely) or any edit to an already-done item's block
//      (which would include silently rewriting its completion evidence -- cycle ID, PR number, merge commit
//      -- while leaving Status: done untouched): once reconciliation has recorded an item as done, that
//      item's entire block is frozen and immutable to the implementation runtime.
function backlogCompletionTampering(base = baseSha()) {
  const backlogRel = ".agent/BACKLOG.md";
  let before;
  try { before = git(["show", `${base}:${backlogRel}`]); } catch { return []; }
  let after;
  try { after = fs.readFileSync(abs(backlogRel), "utf8"); } catch { return []; }
  if (before === after) return [];
  const beforeItems = parseBacklogItems(before);
  const afterItems = parseBacklogItems(after);
  const beforeStatuses = Object.fromEntries(beforeItems.map((item) => [item.id, item.status]));
  const afterById = Object.fromEntries(afterItems.map((item) => [item.id, item]));
  const violations = [];
  for (const afterItem of afterItems) {
    if (afterItem.status === "done" && beforeStatuses[afterItem.id] !== "done") {
      violations.push(`implementation delta marks backlog item ${afterItem.id} done directly in ${backlogRel}; only the deterministic post-merge reconciliation script may record backlog completion`);
    }
  }
  for (const beforeItem of beforeItems) {
    if (beforeItem.status !== "done") continue;
    const afterItem = afterById[beforeItem.id];
    if (!afterItem) {
      violations.push(`implementation delta removes already-completed backlog item ${beforeItem.id} from ${backlogRel}; completed backlog items are immutable to the implementation runtime`);
      continue;
    }
    if (afterItem.status !== "done") {
      violations.push(`implementation delta changes already-completed backlog item ${beforeItem.id} from done to "${afterItem.status}" in ${backlogRel}; completed backlog items are immutable to the implementation runtime`);
      continue;
    }
    if (before.slice(beforeItem.start, beforeItem.end) !== after.slice(afterItem.start, afterItem.end)) {
      violations.push(`implementation delta modifies already-completed backlog item ${beforeItem.id} (including possibly its completion evidence) in ${backlogRel}; completed backlog items are immutable to the implementation runtime`);
    }
  }
  return violations;
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
if (require.main === module) {
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
}
module.exports = { actualImplementationDelta, currentNonRuntimeDelta, fileFingerprint, normalizeRepoPath, isRuntimeEvidencePath, baseSha, loadBaseState, scopeViolations, isPackageLockPath, packageLockManifestPath, parseBacklogItems, backlogStatuses, backlogCompletionTampering };
