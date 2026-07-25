#!/usr/bin/env node
// Engineering Memory Engine v1
//
// Deterministic JSON analysis over archived runs (runs/RUN-NNNNNN/, produced by Run History Manager v1) --
// this is NOT an AI component: no embeddings, no vector database, no LLM. It only aggregates already-
// recorded facts across previous runs (validation scores, iteration counts, modified files, failed rules,
// selected recommendations) so the platform can report on its own track record. It never modifies any
// archived run, never inspects the live repository, and never makes an engineering decision -- it only
// summarizes decisions and outcomes that were already made and already recorded.
//
// Run with:   node scripts/engineering-memory.js
// Input dir defaults to runs/ at the repository root; override with RUN_HISTORY_DIR (the SAME environment
// variable Run History Manager v1 itself uses for that directory).
// Output dir defaults to `memory/` at the repository root; override with ENGINEERING_MEMORY_OUTPUT_DIR.
//
// API SHAPE: like Run History Manager v1, this module offers both a synchronous API (loadRuns/analyzeSync,
// plain `fs`) for the fully-synchronous Autonomous Orchestrator's in-process call site, and an asynchronous
// one (loadRunsAsync/analyze, `fs/promises`) as the primary API for standalone/programmatic use -- this one
// leans on the async form more than Run History Manager did, since reading many run folders' files in
// parallel (Promise.all) is a genuinely better fit for fs/promises than a fixed handful of writes.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runsDir = path.resolve(root, process.env.RUN_HISTORY_DIR || "runs");
const outputDir = path.resolve(root, process.env.ENGINEERING_MEMORY_OUTPUT_DIR || "memory");

const RUN_ID_PATTERN = /^RUN-\d{6}$/;

// The files Run History Manager v1 is known to archive into each run folder. Missing files are never an
// error -- they are simply absent from the loaded run's corresponding field (null), and every downstream
// analysis function treats that exactly like "this run has no opinion on that question," never a crash.
const RUN_JSON_FILES = ["metadata", "metrics", "timeline", "decision", "validation", "reflection", "execution"];

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null; // missing OR corrupted -- both mean "we don't have this data," never guessed at.
  }
}

async function readJsonSafeAsync(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return null;
  }
}

async function readTextSafeAsync(filePath) {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch (error) {
    return null;
  }
}

function listRunIds(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Loads one run folder's known files synchronously. Never throws -- a missing or corrupted file simply
 * becomes `null` for that field.
 * @param {string} runDir absolute path to a single runs/RUN-NNNNNN directory
 * @param {string} runId
 * @returns {object}
 */
function loadRun(runDir, runId) {
  const run = { runId, runDir };
  for (const name of RUN_JSON_FILES) run[name] = readJsonSafe(path.join(runDir, `${name}.json`));
  run.runSummary = readTextSafe(path.join(runDir, "run-summary.md"));
  return run;
}

async function loadRunAsync(runDir, runId) {
  const run = { runId, runDir };
  await Promise.all(
    RUN_JSON_FILES.map(async (name) => {
      run[name] = await readJsonSafeAsync(path.join(runDir, `${name}.json`));
    })
  );
  run.runSummary = await readTextSafeAsync(path.join(runDir, "run-summary.md"));
  return run;
}

/**
 * Loads every run folder under `baseDir` (default: runs/) synchronously, in run-id order. An empty or
 * missing runs/ directory yields an empty array -- not an error; there is simply no history yet.
 * @param {string} [baseDir]
 * @returns {object[]}
 */
function loadRuns(baseDir) {
  const dir = baseDir || runsDir;
  return listRunIds(dir).map((runId) => loadRun(path.join(dir, runId), runId));
}

/**
 * Loads every run folder under `baseDir` asynchronously, reading every run (and every file within a run) in
 * parallel via Promise.all. Same result shape and semantics as loadRuns().
 * @param {string} [baseDir]
 * @returns {Promise<object[]>}
 */
async function loadRunsAsync(baseDir) {
  const dir = baseDir || runsDir;
  const runIds = listRunIds(dir);
  return Promise.all(runIds.map((runId) => loadRunAsync(path.join(dir, runId), runId)));
}

// ---------------------------------------------------------------------------------------------------------
// Analysis helpers -- every one is a pure function of already-loaded runs, deterministic, no AI.
// ---------------------------------------------------------------------------------------------------------

/**
 * @param {object[]} runs result of loadRuns()/loadRunsAsync()
 * @returns {object[]} runs whose metadata.json reports status "SUCCESS"
 */
function findSuccessfulRuns(runs) {
  return runs.filter((run) => run.metadata && run.metadata.status === "SUCCESS");
}

/**
 * @param {object[]} runs result of loadRuns()/loadRunsAsync()
 * @returns {object[]} runs whose metadata.json reports status "FAILED"
 */
function findFailedRuns(runs) {
  return runs.filter((run) => run.metadata && run.metadata.status === "FAILED");
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Averages metrics.json's own validationScore across every run that has a numeric one. Returns null (never
 * 0 or NaN) when no run has a score to average.
 * @param {object[]} runs
 * @returns {(number|null)}
 */
function calculateAverageValidationScore(runs) {
  const scores = runs.map((run) => run.metrics && run.metrics.validationScore).filter((score) => typeof score === "number");
  if (scores.length === 0) return null;
  return round1(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

/**
 * Averages metrics.json's own iterations across every run that has a numeric one. Returns null when no run
 * has an iteration count to average.
 * @param {object[]} runs
 * @returns {(number|null)}
 */
function calculateAverageIterations(runs) {
  const values = runs.map((run) => run.metrics && run.metrics.iterations).filter((value) => typeof value === "number");
  if (values.length === 0) return null;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/**
 * Tallies every FAILed rule's description across every run's validation.json, most common first. Grounded
 * entirely in validation.json's own structured `rules` array -- never a free-text guess.
 * @param {object[]} runs
 * @param {number} [limit]
 * @returns {{reason: string, count: number}[]}
 */
function findMostCommonFailureReasons(runs, limit = 5) {
  const counts = new Map();
  for (const run of runs) {
    const rules = Array.isArray(run.validation && run.validation.rules) ? run.validation.rules : [];
    for (const rule of rules) {
      if (rule && rule.status === "FAIL") {
        const key = rule.description || rule.id;
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, limit);
}

/**
 * Tallies every file named in any run's execution.json modifiedFiles, most-modified first.
 * @param {object[]} runs
 * @param {number} [limit]
 * @returns {{file: string, count: number}[]}
 */
function findMostModifiedFiles(runs, limit = 10) {
  const counts = new Map();
  for (const run of runs) {
    const files = Array.isArray(run.execution && run.execution.modifiedFiles) ? run.execution.modifiedFiles : [];
    for (const file of files) counts.set(file, (counts.get(file) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
    .slice(0, limit);
}

/**
 * Finds which selected recommendations (decision.json's own selectedTitle) most often led to a successful
 * run, with both the success count and how many times that recommendation was attempted at all. Only
 * recommendations with at least one success are included -- never a fabricated "most successful" entry for
 * something that has never actually succeeded.
 * @param {object[]} runs
 * @param {number} [limit]
 * @returns {{title: string, successCount: number, totalCount: number}[]}
 */
function findMostSuccessfulRecommendationPatterns(runs, limit = 5) {
  const totalCounts = new Map();
  const successCounts = new Map();
  for (const run of runs) {
    const title = run.decision && run.decision.selectedTitle;
    if (!title) continue;
    totalCounts.set(title, (totalCounts.get(title) || 0) + 1);
    if (run.metadata && run.metadata.status === "SUCCESS") {
      successCounts.set(title, (successCounts.get(title) || 0) + 1);
    }
  }
  return [...totalCounts.entries()]
    .map(([title, totalCount]) => ({ title, successCount: successCounts.get(title) || 0, totalCount }))
    .filter((entry) => entry.successCount > 0)
    .sort((a, b) => b.successCount - a.successCount || a.title.localeCompare(b.title))
    .slice(0, limit);
}

function summarizeRun(run) {
  const durationMs = (run.metrics && typeof run.metrics.durationMs === "number" && run.metrics.durationMs) ?? (run.metadata && run.metadata.durationMs) ?? null;
  return {
    runId: run.runId,
    durationMs,
    goal: (run.metadata && run.metadata.goal) ?? null,
    provider: (run.metadata && run.metadata.provider) ?? null,
  };
}

/**
 * @param {object[]} successfulRuns result of findSuccessfulRuns()
 * @returns {(object|null)} the successful run with the smallest durationMs, or null if none have a duration
 */
function findFastestSuccessfulRun(successfulRuns) {
  const withDuration = successfulRuns.filter((run) => typeof (run.metrics && run.metrics.durationMs) === "number");
  if (withDuration.length === 0) return null;
  return summarizeRun(withDuration.reduce((fastest, run) => (run.metrics.durationMs < fastest.metrics.durationMs ? run : fastest)));
}

/**
 * @param {object[]} successfulRuns result of findSuccessfulRuns()
 * @returns {(object|null)} the successful run with the largest durationMs, or null if none have a duration
 */
function findSlowestSuccessfulRun(successfulRuns) {
  const withDuration = successfulRuns.filter((run) => typeof (run.metrics && run.metrics.durationMs) === "number");
  if (withDuration.length === 0) return null;
  return summarizeRun(withDuration.reduce((slowest, run) => (run.metrics.durationMs > slowest.metrics.durationMs ? run : slowest)));
}

/**
 * Builds the complete engineering-memory.json document from already-loaded runs. Pure -- no I/O.
 * @param {object[]} runs result of loadRuns()/loadRunsAsync()
 * @returns {object} matching engineering-memory.json's shape
 */
function buildEngineeringMemory(runs) {
  const successfulRuns = findSuccessfulRuns(runs);
  const failedRuns = findFailedRuns(runs);
  return {
    runsAnalyzed: runs.length,
    successfulRuns: successfulRuns.length,
    failedRuns: failedRuns.length,
    averageValidationScore: calculateAverageValidationScore(runs),
    averageIterations: calculateAverageIterations(runs),
    mostModifiedFiles: findMostModifiedFiles(runs),
    mostSuccessfulRecommendations: findMostSuccessfulRecommendationPatterns(runs),
    mostCommonFailureReasons: findMostCommonFailureReasons(runs),
    fastestSuccessfulRun: findFastestSuccessfulRun(successfulRuns),
    slowestSuccessfulRun: findSlowestSuccessfulRun(successfulRuns),
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------------------------------------------

/**
 * Renders the human-readable Markdown report for a given engineering-memory.json document.
 * @param {object} memory result of buildEngineeringMemory()
 * @returns {string}
 */
function renderReportMarkdown(memory) {
  const lines = [];
  lines.push("# Engineering Memory Report", "");
  lines.push(
    "Generated by `scripts/engineering-memory.js` -- deterministic JSON analysis over archived runs (`runs/`). No AI, no embeddings, no vector database, no LLM.",
    ""
  );
  lines.push(`Timestamp: ${memory.timestamp}`, "");

  lines.push("## Overview", "");
  lines.push(`- Runs analyzed: ${memory.runsAnalyzed}`);
  lines.push(`- Successful runs: ${memory.successfulRuns}`);
  lines.push(`- Failed runs: ${memory.failedRuns}`);
  lines.push(`- Average validation score: ${memory.averageValidationScore ?? "N/A"}`);
  lines.push(`- Average iterations: ${memory.averageIterations ?? "N/A"}`);
  lines.push("");

  lines.push("## Most Modified Files", "");
  if (memory.mostModifiedFiles.length === 0) {
    lines.push("None");
  } else {
    memory.mostModifiedFiles.forEach((entry) => lines.push(`- \`${entry.file}\` (${entry.count})`));
  }
  lines.push("");

  lines.push("## Most Successful Recommendations", "");
  if (memory.mostSuccessfulRecommendations.length === 0) {
    lines.push("None");
  } else {
    memory.mostSuccessfulRecommendations.forEach((entry) => lines.push(`- ${entry.title} (${entry.successCount}/${entry.totalCount})`));
  }
  lines.push("");

  lines.push("## Most Common Failure Reasons", "");
  if (memory.mostCommonFailureReasons.length === 0) {
    lines.push("None");
  } else {
    memory.mostCommonFailureReasons.forEach((entry) => lines.push(`- ${entry.reason} (${entry.count})`));
  }
  lines.push("");

  lines.push("## Fastest Successful Run", "");
  lines.push(memory.fastestSuccessfulRun ? `${memory.fastestSuccessfulRun.runId}: ${memory.fastestSuccessfulRun.durationMs}ms` : "None", "");

  lines.push("## Slowest Successful Run", "");
  lines.push(memory.slowestSuccessfulRun ? `${memory.slowestSuccessfulRun.runId}: ${memory.slowestSuccessfulRun.durationMs}ms` : "None", "");

  return lines.join("\n");
}

/**
 * Writes engineering-memory.json and report.md into the output directory (created if needed), synchronously.
 * @param {object} memory
 * @param {string} [outDir] defaults to the module's own configured output directory
 * @returns {{jsonPath: string, mdPath: string}}
 */
function writeOutputsSync(memory, outDir) {
  const dir = outDir || outputDir;
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "engineering-memory.json");
  const mdPath = path.join(dir, "report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(memory, null, 2)}\n`);
  fs.writeFileSync(mdPath, `${renderReportMarkdown(memory)}\n`);
  return { jsonPath, mdPath };
}

/**
 * Writes engineering-memory.json and report.md into the output directory (created if needed), via
 * `fs/promises`.
 * @param {object} memory
 * @param {string} [outDir]
 * @returns {Promise<{jsonPath: string, mdPath: string}>}
 */
async function writeOutputs(memory, outDir) {
  const dir = outDir || outputDir;
  await fsp.mkdir(dir, { recursive: true });
  const jsonPath = path.join(dir, "engineering-memory.json");
  const mdPath = path.join(dir, "report.md");
  await Promise.all([fsp.writeFile(jsonPath, `${JSON.stringify(memory, null, 2)}\n`), fsp.writeFile(mdPath, `${renderReportMarkdown(memory)}\n`)]);
  return { jsonPath, mdPath };
}

/**
 * Loads every archived run, builds engineering-memory.json, and writes both output files -- synchronously.
 * The API scripts/autonomous-orchestrator.js calls directly, since it is itself fully synchronous throughout.
 * @param {{runsDir?: string, outputDir?: string}} [options]
 * @returns {{memory: object, jsonPath: string, mdPath: string}}
 */
function analyzeSync(options) {
  const opts = options || {};
  const runs = loadRuns(opts.runsDir);
  const memory = buildEngineeringMemory(runs);
  const { jsonPath, mdPath } = writeOutputsSync(memory, opts.outputDir);
  return { memory, jsonPath, mdPath };
}

/**
 * Loads every archived run, builds engineering-memory.json, and writes both output files -- asynchronously
 * (`fs/promises`), reading every run's files in parallel. The primary API for standalone/programmatic use.
 * @param {{runsDir?: string, outputDir?: string}} [options]
 * @returns {Promise<{memory: object, jsonPath: string, mdPath: string}>}
 */
async function analyze(options) {
  const opts = options || {};
  const runs = await loadRunsAsync(opts.runsDir);
  const memory = buildEngineeringMemory(runs);
  const { jsonPath, mdPath } = await writeOutputs(memory, opts.outputDir);
  return { memory, jsonPath, mdPath };
}

/**
 * @param {{runsDir?: string, outputDir?: string}} [overrides] test-only escape hatch so this function's real
 *   logic can be exercised against an isolated directory without needing a fresh module instance.
 */
async function main(overrides) {
  const result = await analyze(overrides || {});
  console.log(`Wrote ${path.relative(root, result.jsonPath)}`);
  console.log(`Wrote ${path.relative(root, result.mdPath)}`);
  console.log(`Analyzed ${result.memory.runsAnalyzed} run(s) (${result.memory.successfulRuns} successful, ${result.memory.failedRuns} failed).`);
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
  outputDir,
  RUN_JSON_FILES,
  loadRuns,
  loadRunsAsync,
  findSuccessfulRuns,
  findFailedRuns,
  calculateAverageValidationScore,
  calculateAverageIterations,
  findMostCommonFailureReasons,
  findMostModifiedFiles,
  findMostSuccessfulRecommendationPatterns,
  findFastestSuccessfulRun,
  findSlowestSuccessfulRun,
  buildEngineeringMemory,
  renderReportMarkdown,
  writeOutputsSync,
  writeOutputs,
  analyzeSync,
  analyze,
  main,
};
