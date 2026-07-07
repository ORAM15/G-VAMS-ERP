#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const agentDir = path.join(root, ".agent");
const generatedDir = path.join(agentDir, "generated");

const TEXT_FILES = {
  projectVision: ".agent/PROJECT_VISION.md",
  autonomousRules: ".agent/AUTONOMOUS_RULES.md",
  developmentMemory: ".agent/DEVELOPMENT_MEMORY.md",
  backlog: ".agent/BACKLOG.md",
  projectHealth: "docs/PROJECT_HEALTH.md",
};

const IGNORED_PARTS = new Set([
  ".git",
  "node_modules",
  "build",
  "dist",
  "coverage",
  ".agent/generated",
  "frontend/build",
  "frontend/build-auth-check",
  "frontend/build-erp-check",
  "frontend/build-verify",
]);

function rel(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readText(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return null;
  return fs.readFileSync(absolute, "utf8");
}

function readJson(relativePath) {
  const text = readText(relativePath);
  if (text === null) return null;
  return JSON.parse(text);
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_) {
    return null;
  }
}

function packageSummary(relativePath) {
  const json = readJson(relativePath);
  if (!json) return null;
  return {
    path: relativePath,
    name: json.name || null,
    version: json.version || null,
    private: Boolean(json.private),
    scripts: Object.keys(json.scripts || {}).sort(),
    dependencies: Object.keys(json.dependencies || {}).sort(),
    devDependencies: Object.keys(json.devDependencies || {}).sort(),
  };
}

function shouldIgnore(relativePath) {
  if (!relativePath) return false;
  if (relativePath === ".env" || relativePath.startsWith(".env.")) return true;
  const parts = relativePath.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index + 1).join("/");
    if (IGNORED_PARTS.has(prefix) || IGNORED_PARTS.has(parts[index])) return true;
  }
  const lower = relativePath.toLowerCase();
  return lower.includes("token") || lower.includes("privatekey") || lower.includes("private-key") || lower.endsWith(".pem") || lower.endsWith(".key");
}

function listDirectories(relativePath, maxDepth = 2) {
  const start = path.join(root, relativePath);
  const results = [];
  if (!fs.existsSync(start)) return results;

  function walk(current, depth) {
    if (depth > maxDepth) return;
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryRel = rel(path.join(current, entry.name));
      if (shouldIgnore(entryRel)) continue;
      results.push(entryRel);
      walk(path.join(current, entry.name), depth + 1);
    }
  }

  walk(start, 1);
  return results;
}

function discoverRoutes() {
  const routesDir = path.join(root, "backend/routes");
  if (!fs.existsSync(routesDir)) return [];
  return fs.readdirSync(routesDir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => {
      const relativePath = `backend/routes/${name}`;
      const text = readText(relativePath) || "";
      const routes = [];
      const regex = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]\s*,([^;]+)\);/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        routes.push({ method: match[1].toUpperCase(), path: match[2], handlers: match[3].replace(/\s+/g, " ").trim() });
      }
      return { file: relativePath, routes };
    });
}

function buildContext() {
  const dailyDecisions = readJson(".agent/DAILY_DECISIONS.json");
  const context = {
    schema_version: 1,
    generated_by: "scripts/autonomous-agent-context.js",
    deterministic_note: "No wall-clock timestamp is included to avoid meaningless diffs.",
    git: {
      current_sha: git(["rev-parse", "HEAD"]),
      current_branch: git(["branch", "--show-current"]),
      recent_commit_subjects: (git(["log", "-5", "--pretty=format:%s"]) || "").split("\n").filter(Boolean),
    },
    inputs: Object.fromEntries(Object.entries(TEXT_FILES).map(([key, file]) => [key, { path: file, present: exists(file), content: readText(file) }])),
    dailyDecisions,
    packages: {
      frontend: packageSummary("frontend/package.json"),
      backend: packageSummary("backend/package.json"),
    },
    backendApiStructure: discoverRoutes(),
    importantDirectories: [
      ...listDirectories(".github", 2),
      ...listDirectories(".agent", 2),
      ...listDirectories("backend", 2),
      ...listDirectories("frontend/src", 2),
      ...listDirectories("scripts", 1),
      ...listDirectories("docs", 1),
    ].sort(),
    excludedSecretPatterns: [".env", ".env.*", "Git credentials", "tokens", "private keys", "node_modules", "build outputs"],
  };
  return context;
}

function markdown(context) {
  const lines = [];
  lines.push("# G-VAMS Autonomous Agent Context", "");
  lines.push("Generated by `scripts/autonomous-agent-context.js`.", "");
  lines.push("This context intentionally omits wall-clock timestamps, `.env` files, tokens, private keys, Git credentials, `node_modules`, and unnecessary build output.", "");
  lines.push("## Git", "");
  lines.push(`- Branch: ${context.git.current_branch || "unavailable"}`);
  lines.push(`- Current SHA: ${context.git.current_sha || "unavailable"}`);
  lines.push("- Recent commits:");
  (context.git.recent_commit_subjects.length ? context.git.recent_commit_subjects : ["unavailable"]).forEach((subject) => lines.push(`  - ${subject}`));
  lines.push("");

  for (const [title, input] of Object.entries(context.inputs)) {
    lines.push(`## ${title}`, "");
    lines.push(`Source: \`${input.path}\``);
    lines.push("");
    lines.push(input.present ? input.content.trimEnd() : "Not present.");
    lines.push("");
  }

  lines.push("## Package metadata", "");
  lines.push("```json");
  lines.push(JSON.stringify(context.packages, null, 2));
  lines.push("```", "");
  lines.push("## Backend API structure", "");
  lines.push("```json");
  lines.push(JSON.stringify(context.backendApiStructure, null, 2));
  lines.push("```", "");
  lines.push("## Important directories", "");
  context.importantDirectories.forEach((dir) => lines.push(`- ${dir}`));
  lines.push("");
  lines.push("## Daily decision history", "", "```json", JSON.stringify(context.dailyDecisions, null, 2), "```");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const context = buildContext();
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(path.join(generatedDir, "AGENT_CONTEXT.json"), `${JSON.stringify(context, null, 2)}\n`);
  fs.writeFileSync(path.join(generatedDir, "AGENT_CONTEXT.md"), markdown(context));
  console.log("Generated .agent/generated/AGENT_CONTEXT.md and .agent/generated/AGENT_CONTEXT.json");
}

main();
