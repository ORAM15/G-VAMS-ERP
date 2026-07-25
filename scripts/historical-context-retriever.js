#!/usr/bin/env node
// Historical Context Retriever v1
//
// Retrieves previously archived engineering runs (runs/RUN-NNNNNN/, produced by Run History Manager v1) that
// are relevant to the repository as it stands right now -- BEFORE Recommendation Engine generates new
// recommendations -- so the platform can ground new recommendations in what has already been tried. This is
// NOT an AI component: no embeddings, no vector database, no LLM. It only compares already-recorded, already-
// structured facts (modified files, the recommendation a run selected, its validation outcome, its own
// archived repository-analysis.json's language/frameworks/detected modules/important directories, and its
// goal string) against the CURRENT repository-analysis.json using plain deterministic overlap scoring.
//
// Run with:   node scripts/historical-context-retriever.js
// Inputs (env vars reused verbatim from the engines that already produce them, per this codebase's own
// convention -- see engineering-memory.js's header for the precedent):
//   REPO_INTEL_OUTPUT_DIR          (Repository Intelligence v1's own output dir; default "repository-intelligence")
//   ENGINEERING_MEMORY_OUTPUT_DIR  (Engineering Memory Engine v1's own output dir; default "memory")
//   RUN_HISTORY_DIR                (Run History Manager v1's own archive dir; default "runs")
//   GVAMS_GOAL                     (optional; the same goal string the Orchestrator/CLI already pass through
//                                   to Run History Manager -- used here as an additional relevance signal and,
//                                   when set, as this run's query)
// Output dir defaults to `historical-context/` at the repository root; override with
// HISTORICAL_CONTEXT_OUTPUT_DIR.
//
// FAILURE POLICY: like Run History Manager and Engineering Memory, this engine never fails closed on missing
// or corrupted history -- an empty/missing runs/ directory, a missing repository-analysis.json, or a missing
// engineering-memory.json all degrade gracefully to an honestly low-confidence (or empty) result, never a
// guess. The Autonomous Orchestrator's own integration additionally treats a thrown error here as non-fatal
// (see historical-context-retriever's contract with autonomous-orchestrator.js's runHistoricalContextStage()).
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const root = path.resolve(__dirname, "..");
const repoIntelDir = path.resolve(root, process.env.REPO_INTEL_OUTPUT_DIR || "repository-intelligence");
const memoryDir = path.resolve(root, process.env.ENGINEERING_MEMORY_OUTPUT_DIR || "memory");
const runsDir = path.resolve(root, process.env.RUN_HISTORY_DIR || "runs");
const outputDir = path.resolve(root, process.env.HISTORICAL_CONTEXT_OUTPUT_DIR || "historical-context");

const RUN_ID_PATTERN = /^RUN-\d{6}$/;

// The archived files (see run-history-manager.js's ARTIFACT_MAP/RUN_JSON_FILES for their real names) this
// engine reads per run. repository-analysis.json is included here (Engineering Memory v1 does not read it) --
// it is this engine's only source for a past run's own language/frameworks/detected-modules/directories.
const RUN_JSON_FILES = ["metadata", "decision", "validation", "execution", "repository-analysis"];

const CRITERION_WEIGHT = 1 / 8;
const MIN_RELEVANCE_SCORE = 0; // strictly greater than this to be considered "matching" -- excludes true zero-overlap runs, never an arbitrary cutoff.
const MAX_MATCHING_RUNS = 10;
const MAX_STRATEGIES = 5;
const MAX_AVOID_PATTERNS = 5;

const STOPWORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "are", "was", "has", "have", "will", "would", "should", "could", "your", "their"]);

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

function listRunIds(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Tokenizes free text into a deduplicated, lowercase keyword list: alphanumeric runs of at least 4
 * characters, common stopwords removed. Deterministic, no NLP/AI -- a plain regex + set.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (typeof text !== "string" || !text) return [];
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const seen = new Set();
  const tokens = [];
  for (const word of words) {
    if (word.length < 4 || STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    tokens.push(word);
  }
  return tokens;
}

/**
 * Loads engineering-memory.json (Engineering Memory Engine v1's output). Missing or corrupted is `null`,
 * never a crash -- this engine has an honest, low-confidence answer even with no memory available yet.
 * @param {string} [filePath] defaults to the module's own configured memoryDir/engineering-memory.json
 * @returns {(object|null)}
 */
function loadEngineeringMemory(filePath) {
  return readJsonSafe(filePath || path.join(memoryDir, "engineering-memory.json"));
}

async function loadEngineeringMemoryAsync(filePath) {
  return readJsonSafeAsync(filePath || path.join(memoryDir, "engineering-memory.json"));
}

/**
 * Loads the current repository-analysis.json (Repository Intelligence v1's output).
 * @param {string} [filePath] defaults to the module's own configured repoIntelDir/repository-analysis.json
 * @returns {(object|null)}
 */
function loadRepositoryAnalysis(filePath) {
  return readJsonSafe(filePath || path.join(repoIntelDir, "repository-analysis.json"));
}

async function loadRepositoryAnalysisAsync(filePath) {
  return readJsonSafeAsync(filePath || path.join(repoIntelDir, "repository-analysis.json"));
}

/**
 * Loads every archived run folder's known files under `baseDir` (default: runs/), in run-id order. Missing
 * files within a run are simply `null` on that run's corresponding field. An empty/missing runs/ directory
 * yields an empty array -- there is simply no history yet, never an error.
 * @param {string} [baseDir]
 * @returns {object[]}
 */
function loadRunHistory(baseDir) {
  const dir = baseDir || runsDir;
  return listRunIds(dir).map((runId) => {
    const runDir = path.join(dir, runId);
    const run = { runId, runDir };
    for (const name of RUN_JSON_FILES) run[name === "repository-analysis" ? "repositoryAnalysis" : name] = readJsonSafe(path.join(runDir, `${name}.json`));
    return run;
  });
}

async function loadRunHistoryAsync(baseDir) {
  const dir = baseDir || runsDir;
  const runIds = listRunIds(dir);
  return Promise.all(
    runIds.map(async (runId) => {
      const runDir = path.join(dir, runId);
      const run = { runId, runDir };
      await Promise.all(
        RUN_JSON_FILES.map(async (name) => {
          run[name === "repository-analysis" ? "repositoryAnalysis" : name] = await readJsonSafeAsync(path.join(runDir, `${name}.json`));
        })
      );
      return run;
    })
  );
}

/**
 * Chooses this run's query topic deterministically: GVAMS_GOAL (the same env var the Orchestrator/CLI already
 * pass through), trimmed, if set and non-empty; otherwise the current repository-analysis.json's most
 * strongly detected module (strong confidence beats weak, more evidence files break ties, name breaks any
 * remaining tie); "Unknown" if nothing is detected or repository-analysis.json itself is unavailable.
 * @param {(object|null)} repositoryAnalysis
 * @returns {string}
 */
function selectQuery(repositoryAnalysis) {
  const goal = (process.env.GVAMS_GOAL || "").trim();
  if (goal) return goal;
  const modules = (repositoryAnalysis && repositoryAnalysis.detectedModules) || [];
  const detected = modules.filter((module) => module.detected);
  if (detected.length === 0) return (repositoryAnalysis && repositoryAnalysis.projectName) || "Unknown";
  const confidenceRank = { strong: 1, weak: 0 };
  const best = [...detected].sort(
    (a, b) => (confidenceRank[b.confidence] ?? -1) - (confidenceRank[a.confidence] ?? -1) || (b.evidence || []).length - (a.evidence || []).length || a.name.localeCompare(b.name)
  )[0];
  return best.name;
}

/**
 * Extracts the deterministic topic set the current repository-analysis.json contributes for matching against
 * archived runs: the chosen query, top language, frameworks, detected component (module) names, important
 * directories, and goal keywords (tokenized GVAMS_GOAL plus the generated architecture summary, plus the
 * query itself). A missing/null repositoryAnalysis degrades to an all-empty topic set (query only) -- every
 * downstream scoring criterion treats empty topic arrays as "no opinion," contributing zero, never a crash.
 * @param {(object|null)} repositoryAnalysis result of loadRepositoryAnalysis()/loadRepositoryAnalysisAsync()
 * @returns {{query: string, languages: string[], frameworks: string[], componentNames: string[], directoryNames: string[], goalKeywords: string[]}}
 */
function extractRepositoryTopics(repositoryAnalysis) {
  const query = selectQuery(repositoryAnalysis);
  const languages = repositoryAnalysis && Array.isArray(repositoryAnalysis.languages) ? repositoryAnalysis.languages.map((entry) => entry.language) : [];
  const frameworks = (repositoryAnalysis && repositoryAnalysis.frameworks) || [];
  const componentNames = repositoryAnalysis && Array.isArray(repositoryAnalysis.detectedModules)
    ? repositoryAnalysis.detectedModules.filter((module) => module.detected).map((module) => module.name)
    : [];
  const directoryNames = (repositoryAnalysis && repositoryAnalysis.importantDirectories) || [];
  const goalKeywords = [...new Set([...tokenize(process.env.GVAMS_GOAL || ""), ...tokenize((repositoryAnalysis && repositoryAnalysis.architectureSummary) || ""), ...tokenize(query)])];
  return { query, languages, frameworks, componentNames, directoryNames, goalKeywords };
}

/**
 * Jaccard similarity (intersection / union) between two plain string lists, both treated as sets. Bounded
 * 0-1 and symmetric -- unlike a plain "matched / topicSet.length" fraction, this does not get diluted purely
 * because one side (e.g. goal keywords drawn from a whole architecture summary) happens to be much larger
 * than the other.
 * @param {string[]} candidates
 * @param {string[]} topicSet
 * @returns {number} 0-1
 */
function fractionalOverlap(candidates, topicSet) {
  if (!candidates.length || !topicSet.length) return 0;
  const setA = new Set(candidates);
  const setB = new Set(topicSet);
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection += 1;
  const union = new Set([...setA, ...setB]).size;
  return union ? intersection / union : 0;
}

/**
 * Scores one archived run's relevance to the current repository topics, deterministically, as the mean of
 * eight equally-weighted 0-1 criteria (see this file's header): modified files (do any of the run's modified
 * files mention a current component or directory name?), selected recommendation (does the run's own
 * decision.json selectedTitle mention the current query/a current component?), validation outcome (did the
 * run reach a recorded, decisive outcome at all?), repository language, project type (frameworks overlap),
 * component names overlap, directory names overlap, and goal keywords overlap. Every criterion is a plain
 * comparison against already-recorded JSON fields -- no semantic search, no embeddings, no LLM.
 * @param {object} run one entry from loadRunHistory()/loadRunHistoryAsync()
 * @param {{query: string, languages: string[], frameworks: string[], componentNames: string[], directoryNames: string[], goalKeywords: string[]}} topics result of extractRepositoryTopics()
 * @returns {number} 0-1, rounded to 2 decimals
 */
function scoreRunSimilarity(run, topics) {
  const modifiedFiles = (run.execution && Array.isArray(run.execution.modifiedFiles) && run.execution.modifiedFiles) || [];
  const runRepoAnalysis = run.repositoryAnalysis;
  const needles = [...topics.componentNames, ...topics.directoryNames].map((value) => value.toLowerCase());

  const modifiedFilesScore = modifiedFiles.length && needles.length ? modifiedFiles.filter((file) => needles.some((needle) => file.toLowerCase().includes(needle))).length / modifiedFiles.length : 0;

  const selectedTitle = (run.decision && run.decision.selectedTitle) || "";
  const titleHaystack = selectedTitle.toLowerCase();
  const recommendationScore =
    selectedTitle && (titleHaystack.includes(topics.query.toLowerCase()) || topics.componentNames.some((name) => titleHaystack.includes(name.toLowerCase()))) ? 1 : 0;

  const validationOutcomeScore = run.validation && typeof run.validation.approvedForPR === "boolean" ? 1 : 0;

  const runTopLanguage = runRepoAnalysis && Array.isArray(runRepoAnalysis.languages) && runRepoAnalysis.languages[0] ? runRepoAnalysis.languages[0].language : null;
  const languageScore = runTopLanguage && topics.languages[0] && runTopLanguage === topics.languages[0] ? 1 : 0;

  const runFrameworks = (runRepoAnalysis && runRepoAnalysis.frameworks) || [];
  const projectTypeScore = fractionalOverlap(runFrameworks, topics.frameworks);

  const runComponentNames = runRepoAnalysis && Array.isArray(runRepoAnalysis.detectedModules) ? runRepoAnalysis.detectedModules.filter((m) => m.detected).map((m) => m.name) : [];
  const componentScore = fractionalOverlap(runComponentNames, topics.componentNames);

  const runDirectoryNames = (runRepoAnalysis && runRepoAnalysis.importantDirectories) || [];
  const directoryScore = fractionalOverlap(runDirectoryNames, topics.directoryNames);

  const runGoalTokens = tokenize((run.metadata && run.metadata.goal) || "");
  const goalScore = fractionalOverlap(runGoalTokens, topics.goalKeywords);

  const total =
    (modifiedFilesScore + recommendationScore + validationOutcomeScore + languageScore + projectTypeScore + componentScore + directoryScore + goalScore) * CRITERION_WEIGHT;
  return Math.round(total * 100) / 100;
}

/**
 * Summarizes one archived run into the flat shape used throughout historical-context.json's matchingRuns/
 * successfulRuns/failedRuns arrays.
 * @param {object} run
 * @param {number} score
 * @returns {{runId: string, score: number, status: (string|null), goal: (string|null), provider: (string|null), selectedTitle: (string|null), validationScore: (number|null), approvedForPR: (boolean|null)}}
 */
function summarizeMatch(run, score) {
  return {
    runId: run.runId,
    score,
    status: (run.metadata && run.metadata.status) ?? null,
    goal: (run.metadata && run.metadata.goal) ?? null,
    provider: (run.metadata && run.metadata.provider) ?? null,
    selectedTitle: (run.decision && run.decision.selectedTitle) ?? null,
    validationScore: (run.validation && typeof run.validation.score === "number" ? run.validation.score : null),
    approvedForPR: (run.validation && typeof run.validation.approvedForPR === "boolean" ? run.validation.approvedForPR : null),
  };
}

/**
 * Ranks already-scored {run, score} pairs into historical-context.json's final matchingRuns list: sorted by
 * descending score (ties broken by descending run id, i.e. most recent first), truncated to `limit`, and
 * mapped into summarizeMatch()'s flat shape.
 * @param {{run: object, score: number}[]} scoredRuns
 * @param {number} [limit]
 * @returns {object[]}
 */
function rankHistoricalEvidence(scoredRuns, limit = MAX_MATCHING_RUNS) {
  return [...scoredRuns]
    .sort((a, b) => b.score - a.score || b.run.runId.localeCompare(a.run.runId))
    .slice(0, limit)
    .map(({ run, score }) => summarizeMatch(run, score));
}

/**
 * Scores every archived run against the given topics and returns the ranked, summarized matching runs (score
 * strictly greater than MIN_RELEVANCE_SCORE), most relevant first.
 * @param {object[]} runs result of loadRunHistory()/loadRunHistoryAsync()
 * @param {{query: string, languages: string[], frameworks: string[], componentNames: string[], directoryNames: string[], goalKeywords: string[]}} topics
 * @param {number} [limit]
 * @returns {object[]} matching historical-context.json's own matchingRuns shape
 */
function findRelevantRuns(runs, topics, limit = MAX_MATCHING_RUNS) {
  const scored = runs.map((run) => ({ run, score: scoreRunSimilarity(run, topics) })).filter((entry) => entry.score > MIN_RELEVANCE_SCORE);
  return rankHistoricalEvidence(scored, limit);
}

/**
 * Tallies which selected recommendations (decision.json's selectedTitle) most often appear among relevant,
 * successful runs -- deterministic, most common first (count desc, then title asc).
 * @param {object[]} matchingRuns result of findRelevantRuns() (already-summarized run objects)
 * @param {number} [limit]
 * @returns {{title: string, count: number}[]}
 */
function extractSuccessfulStrategies(matchingRuns, limit = MAX_STRATEGIES) {
  const counts = new Map();
  for (const run of matchingRuns) {
    if (run.status !== "SUCCESS" || !run.selectedTitle) continue;
    counts.set(run.selectedTitle, (counts.get(run.selectedTitle) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/**
 * Tallies the most common validation failure reasons among relevant, failed runs -- deterministic, most
 * common first. Grounded in the run's own archived validation.json rules array, same as
 * engineering-memory.js's findMostCommonFailureReasons(), but scoped only to runs relevant to the current
 * query rather than the whole archive.
 * @param {object[]} runs result of loadRunHistory()/loadRunHistoryAsync() (needs the full validation.rules, not just the summarized matchingRuns shape)
 * @param {Set<string>} matchingRunIds run ids to consider (the already-ranked matching runs' own ids)
 * @param {number} [limit]
 * @returns {{pattern: string, count: number}[]}
 */
function extractFailurePatterns(runs, matchingRunIds, limit = MAX_AVOID_PATTERNS) {
  const counts = new Map();
  for (const run of runs) {
    if (!matchingRunIds.has(run.runId)) continue;
    if (!run.metadata || run.metadata.status !== "FAILED") continue;
    const rules = Array.isArray(run.validation && run.validation.rules) ? run.validation.rules : [];
    for (const rule of rules) {
      if (rule && rule.status === "FAIL") {
        const key = rule.description || rule.id;
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern))
    .slice(0, limit);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Computes overall confidence (0-1) as the mean relevance score of the returned matchingRuns -- 0 when there
 * are none. This is a plain average of already-computed scores, never a fabricated or fuzzy number.
 * @param {{score: number}[]} matchingRuns
 * @returns {number}
 */
function calculateConfidence(matchingRuns) {
  if (matchingRuns.length === 0) return 0;
  return round2(matchingRuns.reduce((sum, run) => sum + run.score, 0) / matchingRuns.length);
}

/**
 * Builds the complete historical-context.json document from already-loaded inputs. Pure -- no I/O.
 * engineering-memory.json is consulted only as a fallback: when no query-relevant run offers a successful
 * strategy or a failure pattern of its own, this engine falls back to Engineering Memory's own global,
 * already-computed mostSuccessfulRecommendations/mostCommonFailureReasons rather than reporting nothing, when
 * that global data is available.
 * @param {{repositoryAnalysis: (object|null), engineeringMemory: (object|null), runs: object[]}} inputs
 * @returns {object} matching historical-context.json's shape
 */
function buildHistoricalContext(inputs) {
  const { repositoryAnalysis, engineeringMemory, runs } = inputs;
  const topics = extractRepositoryTopics(repositoryAnalysis);
  const matchingRuns = findRelevantRuns(runs, topics);
  const matchingRunIds = new Set(matchingRuns.map((run) => run.runId));

  const successfulRuns = matchingRuns.filter((run) => run.status === "SUCCESS");
  const failedRuns = matchingRuns.filter((run) => run.status === "FAILED");

  let recommendedStrategies = extractSuccessfulStrategies(matchingRuns);
  if (recommendedStrategies.length === 0 && engineeringMemory && Array.isArray(engineeringMemory.mostSuccessfulRecommendations)) {
    recommendedStrategies = engineeringMemory.mostSuccessfulRecommendations.map((entry) => ({ title: entry.title, count: entry.successCount })).slice(0, MAX_STRATEGIES);
  }

  let avoidPatterns = extractFailurePatterns(runs, matchingRunIds);
  if (avoidPatterns.length === 0 && engineeringMemory && Array.isArray(engineeringMemory.mostCommonFailureReasons)) {
    avoidPatterns = engineeringMemory.mostCommonFailureReasons.map((entry) => ({ pattern: entry.reason, count: entry.count })).slice(0, MAX_AVOID_PATTERNS);
  }

  return {
    query: topics.query,
    matchingRuns,
    successfulRuns,
    failedRuns,
    recommendedStrategies,
    avoidPatterns,
    confidence: calculateConfidence(matchingRuns),
    runsAnalyzed: runs.length,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------------------------------------------

/**
 * Renders the human-readable Markdown report for a given historical-context.json document.
 * @param {object} context result of buildHistoricalContext()
 * @returns {string}
 */
function renderContextMarkdown(context) {
  const lines = [];
  lines.push("# Historical Context Report", "");
  lines.push(
    "Generated by `scripts/historical-context-retriever.js` -- deterministic matching over archived runs (`runs/`). No AI, no embeddings, no vector database, no LLM.",
    ""
  );
  lines.push(`Query: **${context.query}**`, "");
  lines.push(`Timestamp: ${context.timestamp}`, "");

  lines.push("## Overview", "");
  lines.push(`- Runs analyzed: ${context.runsAnalyzed}`);
  lines.push(`- Matching runs: ${context.matchingRuns.length}`);
  lines.push(`- Successful matches: ${context.successfulRuns.length}`);
  lines.push(`- Failed matches: ${context.failedRuns.length}`);
  lines.push(`- Confidence: ${context.confidence}`);
  lines.push("");

  lines.push("## Matching Runs", "");
  if (context.matchingRuns.length === 0) {
    lines.push("None");
  } else {
    lines.push("| Run ID | Score | Status | Selected Recommendation |", "| --- | ---: | --- | --- |");
    context.matchingRuns.forEach((run) => lines.push(`| ${run.runId} | ${run.score} | ${run.status ?? "N/A"} | ${run.selectedTitle ?? "N/A"} |`));
  }
  lines.push("");

  lines.push("## Recommended Strategies", "");
  if (context.recommendedStrategies.length === 0) {
    lines.push("None");
  } else {
    context.recommendedStrategies.forEach((entry) => lines.push(`- ${entry.title} (${entry.count})`));
  }
  lines.push("");

  lines.push("## Patterns To Avoid", "");
  if (context.avoidPatterns.length === 0) {
    lines.push("None");
  } else {
    context.avoidPatterns.forEach((entry) => lines.push(`- ${entry.pattern} (${entry.count})`));
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Writes historical-context.json and historical-context.md into the output directory (created if needed).
 * @param {object} context
 * @param {string} [outDir] defaults to the module's own configured output directory
 * @returns {{jsonPath: string, mdPath: string}}
 */
function writeOutputsSync(context, outDir) {
  const dir = outDir || outputDir;
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "historical-context.json");
  const mdPath = path.join(dir, "historical-context.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(context, null, 2)}\n`);
  fs.writeFileSync(mdPath, `${renderContextMarkdown(context)}\n`);
  return { jsonPath, mdPath };
}

async function writeOutputs(context, outDir) {
  const dir = outDir || outputDir;
  await fsp.mkdir(dir, { recursive: true });
  const jsonPath = path.join(dir, "historical-context.json");
  const mdPath = path.join(dir, "historical-context.md");
  await Promise.all([fsp.writeFile(jsonPath, `${JSON.stringify(context, null, 2)}\n`), fsp.writeFile(mdPath, `${renderContextMarkdown(context)}\n`)]);
  return { jsonPath, mdPath };
}

/**
 * Loads every input, builds historical-context.json, and writes both output files -- synchronously. The API
 * scripts/autonomous-orchestrator.js calls directly (in-process, same pattern as Run History Manager/
 * Engineering Memory), since the orchestrator is itself fully synchronous throughout.
 * @param {{repositoryAnalysisPath?: string, engineeringMemoryPath?: string, runsDir?: string, outputDir?: string}} [options]
 * @returns {{context: object, jsonPath: string, mdPath: string}}
 */
function retrieveSync(options) {
  const opts = options || {};
  const repositoryAnalysis = loadRepositoryAnalysis(opts.repositoryAnalysisPath);
  const engineeringMemory = loadEngineeringMemory(opts.engineeringMemoryPath);
  const runs = loadRunHistory(opts.runsDir);
  const context = buildHistoricalContext({ repositoryAnalysis, engineeringMemory, runs });
  const { jsonPath, mdPath } = writeOutputsSync(context, opts.outputDir);
  return { context, jsonPath, mdPath };
}

/**
 * Loads every input, builds historical-context.json, and writes both output files -- asynchronously
 * (`fs/promises`). The primary API for standalone/programmatic use.
 * @param {{repositoryAnalysisPath?: string, engineeringMemoryPath?: string, runsDir?: string, outputDir?: string}} [options]
 * @returns {Promise<{context: object, jsonPath: string, mdPath: string}>}
 */
async function retrieve(options) {
  const opts = options || {};
  const [repositoryAnalysis, engineeringMemory, runs] = await Promise.all([
    loadRepositoryAnalysisAsync(opts.repositoryAnalysisPath),
    loadEngineeringMemoryAsync(opts.engineeringMemoryPath),
    loadRunHistoryAsync(opts.runsDir),
  ]);
  const context = buildHistoricalContext({ repositoryAnalysis, engineeringMemory, runs });
  const { jsonPath, mdPath } = await writeOutputs(context, opts.outputDir);
  return { context, jsonPath, mdPath };
}

/**
 * @param {{repositoryAnalysisPath?: string, engineeringMemoryPath?: string, runsDir?: string, outputDir?: string}} [overrides]
 *   test-only escape hatch so this function's real logic can be exercised against isolated directories
 *   without needing a fresh module instance (mirrors engineering-memory.js's/run-history-manager.js's own
 *   main(overrides) precedent).
 */
async function main(overrides) {
  const result = await retrieve(overrides || {});
  console.log(`Wrote ${path.relative(root, result.jsonPath)}`);
  console.log(`Wrote ${path.relative(root, result.mdPath)}`);
  console.log(`Query: "${result.context.query}" -- ${result.context.matchingRuns.length} matching run(s) out of ${result.context.runsAnalyzed} analyzed (confidence ${result.context.confidence}).`);
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
  repoIntelDir,
  memoryDir,
  runsDir,
  outputDir,
  RUN_JSON_FILES,
  tokenize,
  loadEngineeringMemory,
  loadEngineeringMemoryAsync,
  loadRepositoryAnalysis,
  loadRepositoryAnalysisAsync,
  loadRunHistory,
  loadRunHistoryAsync,
  selectQuery,
  extractRepositoryTopics,
  scoreRunSimilarity,
  rankHistoricalEvidence,
  findRelevantRuns,
  extractSuccessfulStrategies,
  extractFailurePatterns,
  calculateConfidence,
  buildHistoricalContext,
  renderContextMarkdown,
  writeOutputsSync,
  writeOutputs,
  retrieveSync,
  retrieve,
  main,
};
