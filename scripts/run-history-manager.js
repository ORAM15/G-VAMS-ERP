#!/usr/bin/env node
// Run History Manager v1
//
// Archives a complete, immutable historical snapshot of one autonomous run: every artifact the pipeline
// actually produced, plus metadata.json/metrics.json/timeline.json/run-summary.md describing what happened.
// Every run gets its own sequentially-numbered folder under runs/ (RUN-000001, RUN-000002, ...) -- nothing
// is ever overwritten. This module never generates code, never modifies any pipeline artifact it archives
// (it only copies them), never invokes AI, and never makes an engineering decision -- it only records what
// already happened.
//
// RUN ID: sequential, never timestamp-based, and persisted without a separate counter file that could drift
// out of sync with reality -- the next id is derived directly from the highest existing runs/RUN-NNNNNN
// folder already on disk (0 if none exist). The runs/ directory itself IS the persistent state; there is
// nothing else to keep consistent with it.
//
// API SHAPE: this module exposes both a synchronous API (archiveRunSync, using plain `fs`, matching every
// other engine's convention in this codebase) and an asynchronous one (archiveRun, using `fs/promises`).
// The synchronous form exists specifically because its primary caller -- the Autonomous Orchestrator -- is
// itself fully synchronous throughout (spawnSync-based, exported functions returning plain values rather
// than Promises); converting that orchestrator to async purely to await this one new step would be a much
// larger, riskier change than this task calls for. The asynchronous form is the "real" fs/promises usage
// this task asked for, and is what this module's own CLI and tests primarily exercise. Both share the exact
// same pure logic (id generation, metadata/metrics/timeline building, Markdown rendering) -- only the I/O
// primitives differ, the same way Node's own `fs` and `fs/promises` are two faces of one API.
//
// Run with:   node scripts/run-history-manager.js   (a standalone convenience mode; see main() below --
// its real integration point is scripts/autonomous-orchestrator.js calling archiveRunSync() directly)
// Output dir defaults to `runs/` at the repository root; override with RUN_HISTORY_DIR.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runsDir = path.resolve(root, process.env.RUN_HISTORY_DIR || "runs");

// Every artifact this engine knows how to archive, and the flattened name it archives under. Source paths
// are this pipeline's real, frozen output locations; archive names match this task's own specified naming
// (e.g. "reflection.json", even though the real source file is reflection/reflection-report.json -- see
// scripts/reflection-engine.js, whose own contract this module does not touch). Missing files are skipped,
// never treated as an error -- "archive whatever exists."
const ARTIFACT_MAP = [
  { source: "repository-intelligence/repository-analysis.json", archiveName: "repository-analysis.json" },
  { source: "engineering-knowledge/engineering-knowledge.json", archiveName: "engineering-knowledge.json" },
  { source: "recommendations/recommendations.json", archiveName: "recommendations.json" },
  { source: "decision/decision.json", archiveName: "decision.json" },
  { source: "implementation-request/implementation-request.json", archiveName: "implementation-request.json" },
  { source: "execution/execution.json", archiveName: "execution.json" },
  { source: "execution/patch-summary.json", archiveName: "patch-summary.json" },
  { source: "validation/validation.json", archiveName: "validation.json" },
  { source: "reflection/reflection-report.json", archiveName: "reflection.json" },
];

const RUN_ID_PATTERN = /^RUN-(\d{6})$/;

/**
 * Formats a positive integer as a zero-padded, six-digit run id.
 * @param {number} number
 * @returns {string}
 */
function formatRunId(number) {
  return `RUN-${String(number).padStart(6, "0")}`;
}

/**
 * Derives the next sequential run id from the highest RUN-NNNNNN folder already present in `baseDir`.
 * Never based on a clock/timestamp, and never relies on a separate counter file -- the directory listing
 * itself is the persistent, self-consistent source of truth.
 * @param {string} baseDir
 * @returns {string}
 */
function getNextRunId(baseDir) {
  if (!fs.existsSync(baseDir)) return formatRunId(1);
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const maxNum = entries.reduce((max, entry) => {
    if (!entry.isDirectory()) return max;
    const match = RUN_ID_PATTERN.exec(entry.name);
    if (!match) return max;
    return Math.max(max, parseInt(match[1], 10));
  }, 0);
  return formatRunId(maxNum + 1);
}

/**
 * Resolves the artifact map to only the entries that actually exist under `sourceDir`, each paired with its
 * absolute source path.
 * @param {string} sourceDir
 * @returns {{sourcePath: string, archiveName: string}[]}
 */
function collectPresentArtifacts(sourceDir) {
  return ARTIFACT_MAP.map(({ source, archiveName }) => ({ sourcePath: path.join(sourceDir, ...source.split("/")), archiveName })).filter(({ sourcePath }) =>
    fs.existsSync(sourcePath)
  );
}

/**
 * Renders a run's captured stdout/stderr entries into one flat, human-readable log file's contents.
 * @param {{stage: string, text: string}[]} entries
 * @returns {string}
 */
function renderLog(entries) {
  const parts = (entries || []).filter((entry) => entry && entry.text).map((entry) => `===== ${entry.stage} =====\n${entry.text}`);
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

/**
 * Builds metadata.json's contents.
 * @param {object} context see archiveRunSync()'s parameter docs
 * @param {string} runId
 * @returns {object}
 */
function buildMetadata(context, runId) {
  return {
    runId,
    status: context.status,
    startedAt: context.startedAt,
    finishedAt: context.finishedAt,
    durationMs: context.durationMs,
    goal: context.goal ?? null,
    provider: context.provider ?? null,
    profile: context.profile ?? null,
    iterations: context.iterations ?? 0,
  };
}

/**
 * Builds metrics.json's contents.
 * @param {object} context see archiveRunSync()'s parameter docs
 * @param {number} artifactsArchivedCount
 * @returns {object}
 */
function buildMetrics(context, artifactsArchivedCount) {
  return {
    iterations: context.iterations ?? 0,
    retryCount: context.retryCount ?? 0,
    artifactsArchived: artifactsArchivedCount,
    validationPassed: Boolean(context.validationPassed),
    validationScore: context.validationScore ?? null,
    reflectionRetryRecommended: Boolean(context.reflectionRetryRecommended),
    durationMs: context.durationMs,
  };
}

/**
 * Builds timeline.json's contents from the orchestrator's own already-captured stage timings.
 * @param {{name: string, durationMs: (number|null)}[]} stageResults
 * @returns {{stage: string, durationMs: (number|null)}[]}
 */
function buildTimeline(stageResults) {
  return (stageResults || []).map((stage) => ({ stage: stage.name, durationMs: stage.durationMs ?? null }));
}

/**
 * Renders run-summary.md's contents.
 * @param {object} metadata result of buildMetadata()
 * @param {object} metrics result of buildMetrics()
 * @returns {string}
 */
function renderSummaryMarkdown(metadata, metrics) {
  const lines = [];
  lines.push("# Run Summary", "");
  lines.push(`- **Run ID:** ${metadata.runId}`);
  lines.push(`- **Status:** ${metadata.status}`);
  lines.push(`- **Goal:** ${metadata.goal ?? "None"}`);
  lines.push(`- **Provider:** ${metadata.provider ?? "None"}`);
  lines.push(`- **Iterations:** ${metadata.iterations}`);
  lines.push(`- **Validation Score:** ${metrics.validationScore ?? "N/A"}`);
  lines.push(`- **Retry Count:** ${metrics.retryCount}`);
  lines.push(`- **Artifacts Archived:** ${metrics.artifactsArchived}`);
  lines.push(`- **Duration:** ${metadata.durationMs}ms`);
  lines.push(`- **Reflection Decision:** ${metrics.reflectionRetryRecommended ? "Retry recommended" : "No retry recommended"}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Archives one complete run synchronously (plain `fs`) -- the API scripts/autonomous-orchestrator.js calls
 * directly, since it is itself fully synchronous throughout.
 * @param {{
 *   runsDir?: string, sourceDir?: string,
 *   status: string, startedAt: string, finishedAt: string, durationMs: number,
 *   goal?: (string|null), provider?: (string|null), profile?: (string|null),
 *   iterations?: number, retryCount?: number,
 *   validationPassed?: boolean, validationScore?: (number|null), reflectionRetryRecommended?: boolean,
 *   stageResults?: {name: string, durationMs: (number|null)}[],
 *   stdoutEntries?: {stage: string, text: string}[], stderrEntries?: {stage: string, text: string}[],
 * }} context
 * @returns {{runId: string, runDir: string, archivedFiles: string[], metadata: object, metrics: object, timeline: object[]}}
 */
function archiveRunSync(context) {
  const baseDir = context.runsDir || runsDir;
  const sourceDir = context.sourceDir || root;
  const runId = getNextRunId(baseDir);
  const destDir = path.join(baseDir, runId);
  fs.mkdirSync(destDir, { recursive: true });

  const present = collectPresentArtifacts(sourceDir);
  present.forEach(({ sourcePath, archiveName }) => fs.copyFileSync(sourcePath, path.join(destDir, archiveName)));
  const archivedFiles = present.map((entry) => entry.archiveName);

  fs.writeFileSync(path.join(destDir, "stdout.log"), renderLog(context.stdoutEntries));
  fs.writeFileSync(path.join(destDir, "stderr.log"), renderLog(context.stderrEntries));

  const metadata = buildMetadata(context, runId);
  const metrics = buildMetrics(context, archivedFiles.length);
  const timeline = buildTimeline(context.stageResults);

  fs.writeFileSync(path.join(destDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  fs.writeFileSync(path.join(destDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  fs.writeFileSync(path.join(destDir, "timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
  fs.writeFileSync(path.join(destDir, "run-summary.md"), renderSummaryMarkdown(metadata, metrics));

  return { runId, runDir: destDir, archivedFiles, metadata, metrics, timeline };
}

/**
 * Archives one complete run asynchronously (`fs/promises`) -- the primary API for standalone/programmatic
 * async callers (this module's own CLI and tests). See archiveRunSync() for the parameter shape; both share
 * the exact same pure logic and differ only in their I/O primitives.
 * @param {object} context same shape as archiveRunSync()'s `context`
 * @returns {Promise<{runId: string, runDir: string, archivedFiles: string[], metadata: object, metrics: object, timeline: object[]}>}
 */
async function archiveRun(context) {
  const baseDir = context.runsDir || runsDir;
  const sourceDir = context.sourceDir || root;
  const runId = getNextRunId(baseDir); // a directory listing -- cheap and synchronous by nature
  const destDir = path.join(baseDir, runId);
  await fsp.mkdir(destDir, { recursive: true });

  const present = collectPresentArtifacts(sourceDir);
  await Promise.all(present.map(({ sourcePath, archiveName }) => fsp.copyFile(sourcePath, path.join(destDir, archiveName))));
  const archivedFiles = present.map((entry) => entry.archiveName);

  const metadata = buildMetadata(context, runId);
  const metrics = buildMetrics(context, archivedFiles.length);
  const timeline = buildTimeline(context.stageResults);

  await Promise.all([
    fsp.writeFile(path.join(destDir, "stdout.log"), renderLog(context.stdoutEntries)),
    fsp.writeFile(path.join(destDir, "stderr.log"), renderLog(context.stderrEntries)),
    fsp.writeFile(path.join(destDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`),
    fsp.writeFile(path.join(destDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`),
    fsp.writeFile(path.join(destDir, "timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`),
    fsp.writeFile(path.join(destDir, "run-summary.md"), renderSummaryMarkdown(metadata, metrics)),
  ]);

  return { runId, runDir: destDir, archivedFiles, metadata, metrics, timeline };
}

/**
 * Standalone CLI mode: archives whatever pipeline artifacts currently exist under the repository root,
 * sourcing metadata from environment variables. A convenience for manual/ad-hoc archiving -- the real
 * integration point is scripts/autonomous-orchestrator.js calling archiveRunSync() directly with rich,
 * in-memory run data.
 * @param {{runsDir?: string, sourceDir?: string}} [overrides] test-only escape hatch so this function's real
 *   env-var-parsing logic can be exercised against an isolated directory without needing a fresh module
 *   instance (module-level `root`/`runsDir` are otherwise fixed at require time, like every other engine's).
 */
async function main(overrides) {
  const context = {
    status: (process.env.RUN_STATUS || "UNKNOWN").toUpperCase(),
    startedAt: process.env.RUN_STARTED_AT || new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Number(process.env.RUN_DURATION_MS) || 0,
    goal: process.env.GVAMS_GOAL || null,
    provider: process.env.EXECUTION_PROVIDER || null,
    profile: process.env.GVAMS_PROFILE || null,
    iterations: Number(process.env.RUN_ITERATIONS) || 0,
    retryCount: Number(process.env.RUN_RETRY_COUNT) || 0,
    validationPassed: process.env.RUN_VALIDATION_PASSED === "true",
    validationScore: process.env.RUN_VALIDATION_SCORE !== undefined && process.env.RUN_VALIDATION_SCORE !== "" ? Number(process.env.RUN_VALIDATION_SCORE) : null,
    reflectionRetryRecommended: process.env.RUN_REFLECTION_RETRY === "true",
    stageResults: [],
    stdoutEntries: [],
    stderrEntries: [],
    ...(overrides || {}),
  };
  const result = await archiveRun(context);
  console.log(`Wrote ${path.relative(root, result.runDir)}/ (${result.archivedFiles.length} artifact(s) archived)`);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  root,
  runsDir,
  ARTIFACT_MAP,
  formatRunId,
  getNextRunId,
  collectPresentArtifacts,
  renderLog,
  buildMetadata,
  buildMetrics,
  buildTimeline,
  renderSummaryMarkdown,
  archiveRunSync,
  archiveRun,
  main,
};
