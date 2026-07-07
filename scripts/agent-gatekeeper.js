#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const requiredInputs = [
  ".agent/PROJECT_VISION.md",
  ".agent/AUTONOMOUS_RULES.md",
  ".agent/DEVELOPMENT_MEMORY.md",
  ".agent/BACKLOG.md",
  ".agent/DAILY_DECISIONS.json",
  ".agent/generated/AGENT_CONTEXT.md",
  ".agent/generated/AGENT_CONTEXT.json",
  "frontend/package.json",
  "backend/package.json",
];
const protectedControlPlane = [
  ".agent/AUTONOMOUS_RULES.md",
  ".agent/PROJECT_VISION.md",
  "scripts/agent-gatekeeper.js",
  "scripts/agent-runtime-adapter.js",
  "scripts/agent-cycle.js",
  ".github/workflows/",
];
const agentStatePaths = [
  ".agent/DEVELOPMENT_MEMORY.md",
  ".agent/BACKLOG.md",
  ".agent/DAILY_DECISIONS.json",
  ".agent/generated/AGENT_CONTEXT.md",
  ".agent/generated/AGENT_CONTEXT.json",
  ".agent/runtime/current-decision.json",
  ".agent/runtime/runtime-result.json",
];
const forbiddenPathPatterns = [
  /^\.env(?:\.|$)/,
  /^\.git(?:\/|$)/,
  /(^|\/)\.git-credentials$/,
  /(^|\/)id_rsa$/,
  /(^|\/)id_ed25519$/,
  /(^|\/).*\.(pem|key|p12|pfx)$/i,
  /(^|\/)(secrets?|credentials?)(\.|\/|$)/i,
];
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
function fail(messages) { messages.forEach((m) => console.error(`ERROR: ${m}`)); process.exit(1); }
function ok(message) { console.log(message); }
function isForbiddenPath(p) { const n = rel(p); return forbiddenPathPatterns.some((r) => r.test(n)); }
function isProtected(p) { const n = rel(p); return protectedControlPlane.some((entry) => entry.endsWith("/") ? n.startsWith(entry) : n === entry); }
function isAgentState(p) { const n = rel(p); return agentStatePaths.includes(n); }
function underAllowed(file, allowed) { const n = rel(file); return allowed.some((a) => { const x = rel(a); return n === x || n.startsWith(x.replace(/\/$/, "") + "/"); }); }
function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function changedFiles() { return git(["diff", "--name-only"]).split("\n").filter(Boolean).map(rel); }
function lineChanges() { const out = git(["diff", "--numstat"]); return out.split("\n").filter(Boolean).reduce((sum, line) => { const [a,b] = line.split(/\s+/); return sum + (Number(a) || 0) + (Number(b) || 0); }, 0); }
function loadConfig() { try { return readJson(".agent/runtime/config.json"); } catch { return {}; } }

function validateInput() {
  const errors = [];
  for (const file of requiredInputs) {
    if (!fs.existsSync(abs(file)) || fs.statSync(abs(file)).size === 0) errors.push(`required trusted input missing or empty: ${file}`);
  }
  for (const file of [".agent/DAILY_DECISIONS.json", ".agent/generated/AGENT_CONTEXT.json", "frontend/package.json", "backend/package.json", ".agent/runtime/config.json"]) {
    if (fs.existsSync(abs(file))) { try { readJson(file); } catch (e) { errors.push(`invalid JSON in ${file}: ${e.message}`); } }
  }
  const scanFiles = [".agent/generated/AGENT_CONTEXT.md", ".agent/generated/AGENT_CONTEXT.json"];
  for (const file of scanFiles) {
    if (!fs.existsSync(abs(file))) continue;
    const text = fs.readFileSync(abs(file), "utf8");
    for (const pattern of secretPatterns) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(text)) !== null) {
        const before = text.slice(0, match.index);
        const line = before.split("\n").length;
        errors.push(`secret-like material detected: file=${file} category=${pattern.category} line=${line}`);
      }
    }
  }
  if (errors.length) fail(errors);
  ok("Input gate passed: trusted files are present, parseable, and generated context passed secret scan.");
}

function validateDecision(file) {
  const d = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8"));
  const errors = [];
  for (const k of ["cycle_id","selected_improvement","selection_reason","declared_scope","allowed_paths","planned_validation","risk_level"]) {
    if (d[k] === undefined || d[k] === null || d[k] === "" || (Array.isArray(d[k]) && d[k].length === 0)) errors.push(`decision missing required non-empty field: ${k}`);
  }
  if (!d.selected_backlog_id && !d.repository_observed_improvement) errors.push("decision must declare selected_backlog_id or repository_observed_improvement");
  if (!/^[A-Za-z0-9._:-]{3,}$/.test(d.cycle_id || "")) errors.push("cycle_id must be stable and non-empty");
  if (!["low","medium","high"].includes(d.risk_level)) errors.push("risk_level must be one of low, medium, high");
  if (!Array.isArray(d.allowed_paths) || d.allowed_paths.length !== new Set(d.allowed_paths).size) errors.push("allowed_paths must be a non-empty unique array");
  for (const p of [...(d.allowed_paths || []), ...(d.forbidden_paths || [])]) {
    if (isForbiddenPath(p)) errors.push(`decision references forbidden path: ${p}`);
    if (isProtected(p)) errors.push(`decision attempts to authorize protected control-plane path: ${p}`);
  }
  if (errors.length) fail(errors);
  ok(`Decision gate passed for ${d.cycle_id}: exactly one declared improvement is scoped.`);
}

function validateDiff(file) {
  const d = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8"));
  const config = loadConfig();
  const thresholds = config.diff_thresholds || {};
  const maxFiles = Number(process.env.AGENT_MAX_CHANGED_FILES || thresholds.max_changed_files || 12);
  const maxLines = Number(process.env.AGENT_MAX_LINE_CHANGES || thresholds.max_line_changes || 500);
  const files = changedFiles();
  const lines = lineChanges();
  const errors = [];
  if (files.length === 0) errors.push("diff is empty");
  if (files.length > maxFiles) errors.push(`changed file threshold exceeded: ${files.length} > ${maxFiles}`);
  if (lines > maxLines) errors.push(`line-change threshold exceeded: ${lines} > ${maxLines}`);
  for (const f of files) {
    if (isForbiddenPath(f)) errors.push(`diff changed forbidden secret-bearing path: ${f}`);
    if (isProtected(f)) errors.push(`diff changed protected control-plane path: ${f}`);
    if (!isAgentState(f) && !underAllowed(f, d.allowed_paths || [])) errors.push(`diff changed out-of-scope path: ${f}`);
  }
  const patch = git(["diff", "--", ".github/workflows"]);
  if (/^\+\s*permissions:/m.test(patch) || /^[-+]\s+\w[\w-]*:\s*(write|all)\b/m.test(patch)) errors.push("workflow permissions appear to be introduced or escalated");
  if (files.some((f) => f.startsWith(".github/workflows/") && !git(["ls-files", "--", f]))) errors.push("new GitHub Actions workflow introduced");
  if (/^[-+].*(npm test|node --check|validation|validate)/mi.test(git(["diff"]))) console.warn("WARNING: validation-related lines changed; human review required.");
  if (errors.length) fail(errors);
  ok(`Diff gate passed: ${files.length} file(s), ${lines} changed line(s), all within approved scope or agent state.`);
}

function validateResult(file) {
  const r = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8"));
  const errors = [];
  for (const k of ["cycle_id","runtime","implementation_summary","changed_files","validation","outcome","known_limitations","recommended_next_direction"]) {
    if (r[k] === undefined || r[k] === null || r[k] === "" || (Array.isArray(r[k]) && k !== "changed_files" && r[k].length === 0)) errors.push(`result missing required field: ${k}`);
  }
  if (!["success","failed","blocked","no_safe_improvement"].includes(r.outcome)) errors.push("result outcome is outside strict enum");
  if ((r.validation || []).some((v) => v.outcome === "failed" || Number(v.exit_code) !== 0) && r.outcome === "success") errors.push("failed validation cannot be represented as success");
  if (r.outcome === "success" && (!Array.isArray(r.changed_files) || r.changed_files.length === 0)) errors.push("success result cannot have an empty changed_files list");
  if (errors.length) fail(errors);
  ok(`Result gate passed for ${r.cycle_id} with outcome=${r.outcome}.`);
}

const [stage, file] = process.argv.slice(2);
try {
  if (stage === "input") validateInput();
  else if (stage === "decision" && file) validateDecision(file);
  else if (stage === "diff" && file) validateDiff(file);
  else if (stage === "result" && file) validateResult(file);
  else fail(["usage: node scripts/agent-gatekeeper.js <input|decision|diff|result> [artifact]"]);
} catch (e) { fail([e.message]); }
