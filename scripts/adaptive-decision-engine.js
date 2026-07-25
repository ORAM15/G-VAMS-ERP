#!/usr/bin/env node
// Adaptive Decision Engine v2
//
// Upgrades Decision Engine v1's selection step: instead of ranking recommendations.json's own candidates by
// their own fields alone, this engine ALSO consults historical-context.json (Historical Context Retriever
// v1's output) and engineering-memory.json (Engineering Memory Engine v1's output) so that a recommendation
// this repository has already tried -- and either succeeded or failed with -- influences which one is
// selected next. This is NOT an AI component: no embeddings, no vector database, no LLM. It is a fixed,
// documented weighted sum over already-computed, already-recorded numbers (see SCORING_FORMULA_DESCRIPTION).
//
// Run with:   node scripts/adaptive-decision-engine.js
// Inputs (env vars reused verbatim from the engines that already produce them, per this codebase's own
// convention -- see historical-context-retriever.js's header for the precedent):
//   RECOMMENDATIONS_PATH           (Recommendation Engine v1's own input-path env var; default
//                                   "recommendations/recommendations.json")
//   HISTORICAL_CONTEXT_OUTPUT_DIR  (Historical Context Retriever v1's own output dir; default
//                                   "historical-context"; this engine reads historical-context.json from it)
//   ENGINEERING_MEMORY_OUTPUT_DIR  (Engineering Memory Engine v1's own output dir; default "memory"; this
//                                   engine reads engineering-memory.json from it)
// Output dir defaults to `decision/` at the repository root (the SAME directory and env var,
// DECISION_OUTPUT_DIR, Decision Engine v1 already uses) -- override with DECISION_OUTPUT_DIR.
//
// OUTPUT: this engine writes TWO artifacts into decision/:
//   - adaptive-decision.json / adaptive-decision.md  (the new, richer artifact this upgrade adds)
//   - decision.json / decision.md                    (Decision Engine v1's own exact contract, still written
//     so surrounding stages -- Implementation Request Engine, Run History Manager, Engineering Memory,
//     Historical Context Retriever -- keep working completely unmodified; see buildCompatDecision())
// scripts/decision-engine.js itself is left entirely untouched (still directly runnable, still relied on by
// several other engines' own end-to-end test fixtures) -- only the Autonomous Orchestrator's Decision Engine
// pipeline SLOT now spawns this engine instead, per this task's own "replace v1 with v2" instruction.
//
// FAILURE POLICY: historical-context.json and engineering-memory.json are both optional, best-effort inputs
// -- missing or corrupted, either degrades gracefully (their respective contributions to the weighted score
// simply become 0 for every candidate, which does not change the RELATIVE ranking driven by
// recommendationScore/confidenceScore) rather than throwing. This is what "fall back to Recommendation
// Engine scores only" means here: the five scoring weights are fixed constants (never renormalized), but
// with no historical signal at all, ranking order naturally reduces to the same recommendationScore/
// confidenceScore ordering Decision Engine v1 itself would have produced. recommendations.json remains a
// required input (unchanged from Decision Engine v1): with no candidates to evaluate, there is nothing to
// decide, so that failure mode is preserved as-is.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const recommendationsPath = path.resolve(root, process.env.RECOMMENDATIONS_PATH || "recommendations/recommendations.json");
const historicalContextDir = path.resolve(root, process.env.HISTORICAL_CONTEXT_OUTPUT_DIR || "historical-context");
const historicalContextPath = path.join(historicalContextDir, "historical-context.json");
const engineeringMemoryDir = path.resolve(root, process.env.ENGINEERING_MEMORY_OUTPUT_DIR || "memory");
const engineeringMemoryPath = path.join(engineeringMemoryDir, "engineering-memory.json");
const outputDir = path.resolve(root, process.env.DECISION_OUTPUT_DIR || "decision");

// Fixed, documented scoring weights -- "Weights must be constants." They always sum to 1.0 and are never
// renormalized based on which inputs happen to be available (see the FAILURE POLICY note above).
const WEIGHTS = {
  recommendationQuality: 0.4,
  historicalSuccess: 0.3,
  validationScore: 0.15,
  frequency: 0.1,
  confidence: 0.05,
};

const IMPACT_BONUS = { High: 6, Medium: 0, Low: -6 };
const RISK_PENALTY = { Low: 0, Medium: 4, High: 10, "Not applicable": 0 };
const SIZE_PENALTY = { Small: 0, Medium: 2, Large: 6 };

const SCORING_FORMULA_DESCRIPTION =
  `finalScore = round(clamp(recommendationScore*${WEIGHTS.recommendationQuality} + historicalSuccessRate*${WEIGHTS.historicalSuccess} + ` +
  `validationScore*${WEIGHTS.validationScore} + frequencyScore*${WEIGHTS.frequency} + confidenceScore*${WEIGHTS.confidence}, 0, 100)). ` +
  "recommendationScore is Decision Engine v1's own priorityScore/confidence/impact/risk/size blend (Recommendation Quality). " +
  "historicalSuccessRate is the percentage of this exact recommendation title's past archived runs (historical-context.json's " +
  "matchingRuns, falling back to engineering-memory.json's mostSuccessfulRecommendations) that succeeded. validationScore is the " +
  "average recorded validation score of those same past runs (falling back to engineering-memory.json's global average). " +
  "frequencyScore is how often this title was selected among historically relevant runs. confidenceScore is the recommendation's " +
  "own detection confidence from recommendations.json. Candidates are ranked by finalScore descending; ties are broken, in order, " +
  "by higher recommendationScore, then higher confidenceScore, then lower id -- a total order, so the same input always yields " +
  "the same single selection. All five weights are fixed constants, never renormalized -- with no historical data available, " +
  "historicalSuccessRate/validationScore/frequencyScore are 0 for every candidate, which does not change the ranking ORDER driven " +
  "by recommendationScore/confidenceScore, matching this engine's documented fallback behavior.";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonSafe(file) {
  try {
    return readJson(file);
  } catch (error) {
    return null; // missing OR corrupted -- both mean "no opinion," never guessed at.
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Loads and parses recommendations.json. Fails closed with a clear, actionable error if the file is missing
 * or not valid JSON -- unchanged from Decision Engine v1: with zero candidates, there is nothing to decide.
 * @param {string} file absolute path to recommendations.json
 * @returns {object} the parsed recommendations document
 */
function loadRecommendations(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`recommendations.json not found at ${path.relative(root, file)}. Run \`node scripts/recommendation-engine.js\` first (or set RECOMMENDATIONS_PATH).`);
  }
  try {
    return readJson(file);
  } catch (error) {
    throw new Error(`recommendations.json at ${path.relative(root, file)} is not valid JSON: ${error.message}`);
  }
}

/**
 * Loads and parses historical-context.json (Historical Context Retriever v1's output). Missing or corrupted
 * is `null`, never a crash -- per this engine's explicit failure policy, this input is entirely optional.
 * @param {string} file absolute path to historical-context.json
 * @returns {(object|null)}
 */
function loadHistoricalContext(file) {
  return readJsonSafe(file);
}

/**
 * Loads and parses engineering-memory.json (Engineering Memory Engine v1's output). Missing or corrupted is
 * `null`, never a crash -- an optional, best-effort fallback input, same treatment as historical-context.json.
 * @param {string} file absolute path to engineering-memory.json
 * @returns {(object|null)}
 */
function loadEngineeringMemory(file) {
  return readJsonSafe(file);
}

/**
 * Finds every historical-context.json matchingRuns entry that selected this exact recommendation title.
 * Exact string comparison only -- no fuzzy/semantic matching.
 * @param {{title: string}} recommendation
 * @param {(object|null)} historicalContext
 * @returns {object[]}
 */
function findMatchingHistoricalRuns(recommendation, historicalContext) {
  if (!historicalContext || !Array.isArray(historicalContext.matchingRuns)) return [];
  return historicalContext.matchingRuns.filter((run) => run.selectedTitle === recommendation.title);
}

/**
 * Finds engineering-memory.json's own mostSuccessfulRecommendations entry for this exact recommendation
 * title, if any -- the fallback data source when historical-context.json has no runs for this title.
 * @param {{title: string}} recommendation
 * @param {(object|null)} engineeringMemory
 * @returns {({title: string, successCount: number, totalCount: number}|null)}
 */
function findEngineeringMemoryEntry(recommendation, engineeringMemory) {
  if (!engineeringMemory || !Array.isArray(engineeringMemory.mostSuccessfulRecommendations)) return null;
  return engineeringMemory.mostSuccessfulRecommendations.find((entry) => entry.title === recommendation.title) || null;
}

/**
 * Recommendation Quality (0-100): reuses Decision Engine v1's own documented priorityScore/confidence/
 * impact/risk/size blend, self-contained here (not required from decision-engine.js, matching this
 * codebase's convention of each engine owning its own formula rather than sharing modules).
 * @param {{priorityScore: number, confidence: number, estimatedImpact: string, estimatedRisk: string, estimatedImplementationSize: string}} recommendation
 * @returns {number} 0-100
 */
function calculateRecommendationScore(recommendation) {
  const base = recommendation.priorityScore * 0.6 + recommendation.confidence * 0.4;
  const impactBonus = IMPACT_BONUS[recommendation.estimatedImpact] ?? 0;
  const riskPenalty = RISK_PENALTY[recommendation.estimatedRisk] ?? 0;
  const sizePenalty = SIZE_PENALTY[recommendation.estimatedImplementationSize] ?? 0;
  return clamp(Math.round(base + impactBonus - riskPenalty - sizePenalty), 0, 100);
}

/**
 * Historical Success (0-100): the percentage of this title's own matching historical runs that succeeded,
 * falling back to engineering-memory.json's global successCount/totalCount for this title, falling back to 0.
 * @param {{title: string}} recommendation
 * @param {(object|null)} historicalContext
 * @param {(object|null)} engineeringMemory
 * @returns {number} 0-100
 */
function calculateHistoricalScore(recommendation, historicalContext, engineeringMemory) {
  const matches = findMatchingHistoricalRuns(recommendation, historicalContext);
  if (matches.length > 0) {
    const successCount = matches.filter((run) => run.status === "SUCCESS").length;
    return Math.round((successCount / matches.length) * 100);
  }
  const memoryEntry = findEngineeringMemoryEntry(recommendation, engineeringMemory);
  if (memoryEntry && memoryEntry.totalCount > 0) {
    return Math.round((memoryEntry.successCount / memoryEntry.totalCount) * 100);
  }
  return 0;
}

/**
 * Historical evidence: how many past runs actually back this title's historicalSuccessRate -- reported
 * alongside it so a 100% success rate backed by 1 run reads very differently from one backed by 10.
 * @param {{title: string}} recommendation
 * @param {(object|null)} historicalContext
 * @param {(object|null)} engineeringMemory
 * @returns {number}
 */
function countHistoricalEvidence(recommendation, historicalContext, engineeringMemory) {
  const matches = findMatchingHistoricalRuns(recommendation, historicalContext);
  if (matches.length > 0) return matches.length;
  const memoryEntry = findEngineeringMemoryEntry(recommendation, engineeringMemory);
  return memoryEntry ? memoryEntry.totalCount : 0;
}

/**
 * Validation Score (0-100): the average recorded validation score of this title's own matching historical
 * runs, falling back to engineering-memory.json's global averageValidationScore, falling back to 0.
 * @param {{title: string}} recommendation
 * @param {(object|null)} historicalContext
 * @param {(object|null)} engineeringMemory
 * @returns {number} 0-100
 */
function calculateValidationScore(recommendation, historicalContext, engineeringMemory) {
  const matches = findMatchingHistoricalRuns(recommendation, historicalContext);
  const scores = matches.map((run) => run.validationScore).filter((score) => typeof score === "number");
  if (scores.length > 0) return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  if (engineeringMemory && typeof engineeringMemory.averageValidationScore === "number") return Math.round(engineeringMemory.averageValidationScore);
  return 0;
}

/**
 * Frequency (0-100): how often this title was selected among ALL of historical-context.json's matchingRuns
 * (a measure of how consistently this exact strategy keeps coming up as relevant), falling back to
 * engineering-memory.json's totalCount/runsAnalyzed, falling back to 0.
 * @param {{title: string}} recommendation
 * @param {(object|null)} historicalContext
 * @param {(object|null)} engineeringMemory
 * @returns {number} 0-100
 */
function calculateFrequencyScore(recommendation, historicalContext, engineeringMemory) {
  if (historicalContext && Array.isArray(historicalContext.matchingRuns) && historicalContext.matchingRuns.length > 0) {
    const matches = findMatchingHistoricalRuns(recommendation, historicalContext);
    return Math.round((matches.length / historicalContext.matchingRuns.length) * 100);
  }
  const memoryEntry = findEngineeringMemoryEntry(recommendation, engineeringMemory);
  if (memoryEntry && engineeringMemory && engineeringMemory.runsAnalyzed > 0) {
    return Math.round((memoryEntry.totalCount / engineeringMemory.runsAnalyzed) * 100);
  }
  return 0;
}

/**
 * Confidence (0-100): the recommendation's own detection confidence, already computed by Recommendation
 * Engine v1 (recommendations.json's own `confidence` field) -- read directly, never re-derived.
 * @param {{confidence: number}} recommendation
 * @returns {number} 0-100
 */
function calculateConfidenceScore(recommendation) {
  return clamp(Math.round(recommendation.confidence), 0, 100);
}

/**
 * Computes one candidate's fixed-weight final score (see SCORING_FORMULA_DESCRIPTION) from its five already-
 * computed sub-scores. Pure arithmetic, no I/O.
 * @param {{recommendationScore: number, historicalScore: number, validationScore: number, frequencyScore: number, confidenceScore: number}} subScores
 * @returns {number} 0-100
 */
function calculateFinalScore(subScores) {
  const raw =
    subScores.recommendationScore * WEIGHTS.recommendationQuality +
    subScores.historicalScore * WEIGHTS.historicalSuccess +
    subScores.validationScore * WEIGHTS.validationScore +
    subScores.frequencyScore * WEIGHTS.frequency +
    subScores.confidenceScore * WEIGHTS.confidence;
  return clamp(Math.round(raw), 0, 100);
}

/**
 * Scores and totally orders every recommendation via the fixed five-weight formula. Stable regardless of the
 * input array's original order, since the comparator always falls through to `id` as a final, unique
 * tie-break.
 * @param {object[]} recommendations raw recommendation objects from recommendations.json
 * @param {(object|null)} historicalContext result of loadHistoricalContext()
 * @param {(object|null)} engineeringMemory result of loadEngineeringMemory()
 * @returns {object[]} recommendations, each with added score fields, sorted by rank (best first)
 */
function rankRecommendations(recommendations, historicalContext, engineeringMemory) {
  const scored = recommendations.map((recommendation) => {
    const recommendationScore = calculateRecommendationScore(recommendation);
    const historicalScore = calculateHistoricalScore(recommendation, historicalContext, engineeringMemory);
    const historicalEvidence = countHistoricalEvidence(recommendation, historicalContext, engineeringMemory);
    const validationScore = calculateValidationScore(recommendation, historicalContext, engineeringMemory);
    const frequencyScore = calculateFrequencyScore(recommendation, historicalContext, engineeringMemory);
    const confidenceScore = calculateConfidenceScore(recommendation);
    const finalScore = calculateFinalScore({ recommendationScore, historicalScore, validationScore, frequencyScore, confidenceScore });
    return { ...recommendation, recommendationScore, historicalScore, historicalEvidence, validationScore, frequencyScore, confidenceScore, finalScore };
  });
  return scored.sort(
    (a, b) => b.finalScore - a.finalScore || b.recommendationScore - a.recommendationScore || b.confidenceScore - a.confidenceScore || a.id - b.id
  );
}

/**
 * @param {object[]} ranked rankRecommendations() output
 * @returns {(object|null)} the top-ranked candidate, or null if there were none to rank
 */
function selectBestRecommendation(ranked) {
  return ranked.length > 0 ? ranked[0] : null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Overall selection confidence (0-1, distinct from any candidate's own 0-100 confidenceScore): a documented
 * blend of the winner's own final-score ratio and historical-context.json's own already-reported top-level
 * confidence (falling back to the winner's own ratio again when historical-context.json is unavailable, so
 * this collapses to exactly the winner's finalScore/100 with no historical signal at all).
 * @param {(object|null)} winner rankRecommendations() top entry, or null
 * @param {(object|null)} historicalContext
 * @returns {number} 0-1
 */
function calculateOverallConfidence(winner, historicalContext) {
  if (!winner) return 0;
  const ownRatio = winner.finalScore / 100;
  const historicalConfidence = historicalContext && typeof historicalContext.confidence === "number" ? historicalContext.confidence : ownRatio;
  return round2(clamp(ownRatio * 0.6 + historicalConfidence * 0.4, 0, 1));
}

function relFrom(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * Builds the complete adaptive-decision.json document from an already-computed ranking. Pure -- no I/O.
 * @param {object} recommendationsDoc parsed recommendations.json
 * @param {object[]} ranked rankRecommendations() output
 * @param {(object|null)} historicalContext
 * @param {{recommendationsPath: string, historicalContextPath: string, engineeringMemoryPath: string}} sources absolute paths actually used
 * @returns {object} matching adaptive-decision.json's shape
 */
function buildAdaptiveDecision(recommendationsDoc, ranked, historicalContext, sources) {
  const base = {
    generatedFrom: relFrom(sources.recommendationsPath),
    historicalContextSource: relFrom(sources.historicalContextPath),
    engineeringMemorySource: relFrom(sources.engineeringMemoryPath),
    sourceProjectName: recommendationsDoc.sourceProjectName,
    sourceTimestamp: recommendationsDoc.timestamp,
    scoringWeights: { ...WEIGHTS },
    scoringFormula: SCORING_FORMULA_DESCRIPTION,
    historicalContextAvailable: historicalContext !== null,
    candidatesEvaluated: ranked.length,
    timestamp: new Date().toISOString(),
  };

  const winner = selectBestRecommendation(ranked);
  if (!winner) {
    return {
      ...base,
      selectedRecommendationId: null,
      selectedRecommendation: null,
      selectionReason: { recommendationScore: 0, historicalSuccessRate: 0, historicalEvidence: 0, confidence: 0 },
      estimatedImpact: "Not applicable",
      estimatedRisk: "Not applicable",
      estimatedImplementationSize: "Not applicable",
      finalScore: 0,
      alternatives: [],
    };
  }

  const alternatives = ranked.slice(1).map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    finalScore: candidate.finalScore,
    recommendationScore: candidate.recommendationScore,
    historicalSuccessRate: candidate.historicalScore,
    historicalEvidence: candidate.historicalEvidence,
    validationScore: candidate.validationScore,
    frequencyScore: candidate.frequencyScore,
    confidenceScore: candidate.confidenceScore,
  }));

  return {
    ...base,
    selectedRecommendationId: winner.id,
    selectedRecommendation: winner.title,
    selectionReason: {
      recommendationScore: winner.recommendationScore,
      historicalSuccessRate: winner.historicalScore,
      historicalEvidence: winner.historicalEvidence,
      confidence: calculateOverallConfidence(winner, historicalContext),
    },
    estimatedImpact: winner.estimatedImpact,
    estimatedRisk: winner.estimatedRisk,
    estimatedImplementationSize: winner.estimatedImplementationSize,
    finalScore: winner.finalScore,
    alternatives,
  };
}

function buildCompatDecisionReasons(winner, ranked, historicalContextAvailable) {
  const reasons = [
    `Evaluated ${ranked.length} candidate recommendation(s) using Adaptive Decision Engine v2's weighted scoring (Recommendation Quality 40%, Historical Success 30%, Validation Score 15%, Frequency 10%, Confidence 5%).`,
    `Highest final score: ${winner.finalScore}/100 (recommendationScore ${winner.recommendationScore}, historicalSuccessRate ${winner.historicalScore}%, historicalEvidence ${winner.historicalEvidence} run(s)).`,
    historicalContextAvailable
      ? "historical-context.json was available and influenced this selection."
      : "historical-context.json was unavailable; this selection fell back to Recommendation Engine scores only.",
  ];
  if (ranked.length > 1) {
    const runnerUp = ranked[1];
    reasons.push(`Ahead of the next-best candidate, recommendation #${runnerUp.id} ("${runnerUp.title}"), by ${winner.finalScore - runnerUp.finalScore} final-score point(s).`);
  } else {
    reasons.push("Only one candidate recommendation was available; selected by default.");
  }
  return reasons;
}

/**
 * Builds decision.json in Decision Engine v1's own exact contract -- selectedRecommendationId/selectedTitle/
 * sourceProjectName/sourceTimestamp/timestamp/estimatedRisk/estimatedImplementationSize, the fields
 * Implementation Request Engine (and archived-run readers Run History Manager/Engineering Memory/Historical
 * Context Retriever) already depend on -- so this engine is a drop-in replacement for Decision Engine v1 in
 * the Orchestrator's pipeline slot. Reuses the SAME ranking/winner/timestamp as adaptiveDecision so both
 * artifacts describe the exact same decision instant.
 * @param {object[]} ranked rankRecommendations() output
 * @param {object} adaptiveDecision result of buildAdaptiveDecision() (for its already-computed base fields)
 * @param {boolean} historicalContextAvailable
 * @returns {object} matching decision.json's shape
 */
function buildCompatDecision(ranked, adaptiveDecision, historicalContextAvailable) {
  const base = {
    generatedFrom: adaptiveDecision.generatedFrom,
    sourceProjectName: adaptiveDecision.sourceProjectName,
    sourceTimestamp: adaptiveDecision.sourceTimestamp,
    decisionFormula: adaptiveDecision.scoringFormula,
    candidatesEvaluated: adaptiveDecision.candidatesEvaluated,
    timestamp: adaptiveDecision.timestamp,
  };

  const winner = selectBestRecommendation(ranked);
  if (!winner) {
    return {
      ...base,
      selectedRecommendationId: null,
      selectedTitle: null,
      decisionConfidence: 0,
      decisionReasons: ["No recommendations were present in recommendations.json; there is nothing to decide."],
      estimatedImpact: "Not applicable",
      estimatedRisk: "Not applicable",
      estimatedImplementationSize: "Not applicable",
      candidateScores: [],
    };
  }

  return {
    ...base,
    selectedRecommendationId: winner.id,
    selectedTitle: winner.title,
    decisionConfidence: Math.round((adaptiveDecision.selectionReason.confidence ?? 0) * 100),
    decisionReasons: buildCompatDecisionReasons(winner, ranked, historicalContextAvailable),
    estimatedImpact: winner.estimatedImpact,
    estimatedRisk: winner.estimatedRisk,
    estimatedImplementationSize: winner.estimatedImplementationSize,
    candidateScores: ranked.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      finalScore: candidate.finalScore,
      recommendationScore: candidate.recommendationScore,
      historicalSuccessRate: candidate.historicalScore,
      confidenceScore: candidate.confidenceScore,
      selected: candidate.id === winner.id,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Report Generators
// ---------------------------------------------------------------------------------------------------------

/**
 * Renders the human-readable Markdown report for adaptive-decision.json.
 * @param {object} adaptiveDecision result of buildAdaptiveDecision()
 * @returns {string}
 */
function renderAdaptiveDecisionMarkdown(adaptiveDecision) {
  const lines = [];
  lines.push("# Adaptive Decision Engine v2 Report", "");
  lines.push(
    "Generated by `scripts/adaptive-decision-engine.js` -- deterministic, no AI/LLM/embeddings involved. Ranks recommendations.json's candidates using a fixed weighted formula that also consults historical-context.json and engineering-memory.json.",
    ""
  );
  lines.push(`Source: \`${adaptiveDecision.generatedFrom}\` (project: ${adaptiveDecision.sourceProjectName}, generated ${adaptiveDecision.sourceTimestamp})`, "");
  lines.push(`Timestamp: ${adaptiveDecision.timestamp}`, "");
  lines.push(`Historical context available: ${adaptiveDecision.historicalContextAvailable ? "yes" : "no (fell back to Recommendation Engine scores only)"}`, "");
  lines.push("## Scoring formula", "");
  lines.push(adaptiveDecision.scoringFormula, "");
  lines.push("## Scoring weights", "");
  lines.push("| Component | Weight |", "| --- | ---: |");
  lines.push(`| Recommendation Quality | ${adaptiveDecision.scoringWeights.recommendationQuality * 100}% |`);
  lines.push(`| Historical Success | ${adaptiveDecision.scoringWeights.historicalSuccess * 100}% |`);
  lines.push(`| Validation Score | ${adaptiveDecision.scoringWeights.validationScore * 100}% |`);
  lines.push(`| Frequency | ${adaptiveDecision.scoringWeights.frequency * 100}% |`);
  lines.push(`| Confidence | ${adaptiveDecision.scoringWeights.confidence * 100}% |`);
  lines.push("");

  if (adaptiveDecision.selectedRecommendationId === null) {
    lines.push("## Selection", "");
    lines.push("No recommendation was selected: recommendations.json contained zero candidates to evaluate.", "");
    return lines.join("\n");
  }

  lines.push(`## Selected: #${adaptiveDecision.selectedRecommendationId} -- ${adaptiveDecision.selectedRecommendation}`, "");
  lines.push(`**Final score:** ${adaptiveDecision.finalScore}/100 | **Impact:** ${adaptiveDecision.estimatedImpact} | **Risk:** ${adaptiveDecision.estimatedRisk} | **Size:** ${adaptiveDecision.estimatedImplementationSize}`, "");
  lines.push("### Selection reason", "");
  lines.push(`- Recommendation score: ${adaptiveDecision.selectionReason.recommendationScore}/100`);
  lines.push(`- Historical success rate: ${adaptiveDecision.selectionReason.historicalSuccessRate}%`);
  lines.push(`- Historical evidence: ${adaptiveDecision.selectionReason.historicalEvidence} matching run(s)`);
  lines.push(`- Confidence: ${adaptiveDecision.selectionReason.confidence}`);
  lines.push("");

  lines.push("### Alternatives", "");
  if (adaptiveDecision.alternatives.length === 0) {
    lines.push("None -- only one candidate recommendation was available.");
  } else {
    lines.push("| ID | Title | Final score | Recommendation score | Historical success | Evidence |", "| ---: | --- | ---: | ---: | ---: | ---: |");
    adaptiveDecision.alternatives.forEach((alt) => {
      lines.push(`| ${alt.id} | ${alt.title} | ${alt.finalScore} | ${alt.recommendationScore} | ${alt.historicalSuccessRate}% | ${alt.historicalEvidence} |`);
    });
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Renders the human-readable Markdown report for the compatibility decision.json (Decision Engine v1's own
 * report format, adapted for this engine's scoring fields).
 * @param {object} compatDecision result of buildCompatDecision()
 * @returns {string}
 */
function renderDecisionMarkdown(compatDecision) {
  const lines = [];
  lines.push("# Decision Engine Report", "");
  lines.push(
    "Generated by `scripts/adaptive-decision-engine.js` (Adaptive Decision Engine v2) -- deterministic, no AI/LLM involved. This is Decision Engine v1's own compatibility report format; see adaptive-decision.md for the full historical-context-aware breakdown.",
    ""
  );
  lines.push(`Source: \`${compatDecision.generatedFrom}\` (project: ${compatDecision.sourceProjectName}, generated ${compatDecision.sourceTimestamp})`, "");
  lines.push(`Timestamp: ${compatDecision.timestamp}`, "");
  lines.push("## Decision formula", "");
  lines.push(compatDecision.decisionFormula, "");

  if (compatDecision.selectedRecommendationId === null) {
    lines.push("## Selection", "");
    lines.push("No recommendation was selected: recommendations.json contained zero candidates to evaluate.", "");
    return lines.join("\n");
  }

  lines.push(`## Selected: #${compatDecision.selectedRecommendationId} -- ${compatDecision.selectedTitle}`, "");
  lines.push(`**Decision confidence:** ${compatDecision.decisionConfidence}% | **Impact:** ${compatDecision.estimatedImpact} | **Risk:** ${compatDecision.estimatedRisk} | **Size:** ${compatDecision.estimatedImplementationSize}`, "");
  lines.push("### Why this recommendation was selected", "");
  compatDecision.decisionReasons.forEach((reason) => lines.push(`- ${reason}`));
  lines.push("");

  lines.push("### Every candidate considered", "");
  lines.push("| Rank | Selected | ID | Title | Final score | Recommendation score | Historical success |", "| ---: | :---: | ---: | --- | ---: | ---: | ---: |");
  compatDecision.candidateScores.forEach((candidate, index) => {
    lines.push(`| ${index + 1} | ${candidate.selected ? "✓" : ""} | ${candidate.id} | ${candidate.title} | ${candidate.finalScore} | ${candidate.recommendationScore} | ${candidate.historicalSuccessRate}% |`);
  });
  lines.push("");

  return lines.join("\n");
}

/**
 * Writes adaptive-decision.json/.md and decision.json/.md into the output directory (created if needed).
 * @param {object} adaptiveDecision
 * @param {object} compatDecision
 * @param {string} [outDir] defaults to the module's own configured output directory
 * @returns {{adaptiveJsonPath: string, adaptiveMdPath: string, decisionJsonPath: string, decisionMdPath: string}}
 */
function writeOutputs(adaptiveDecision, compatDecision, outDir) {
  const dir = outDir || outputDir;
  fs.mkdirSync(dir, { recursive: true });
  const adaptiveJsonPath = path.join(dir, "adaptive-decision.json");
  const adaptiveMdPath = path.join(dir, "adaptive-decision.md");
  const decisionJsonPath = path.join(dir, "decision.json");
  const decisionMdPath = path.join(dir, "decision.md");
  fs.writeFileSync(adaptiveJsonPath, `${JSON.stringify(adaptiveDecision, null, 2)}\n`);
  fs.writeFileSync(adaptiveMdPath, `${renderAdaptiveDecisionMarkdown(adaptiveDecision)}\n`);
  fs.writeFileSync(decisionJsonPath, `${JSON.stringify(compatDecision, null, 2)}\n`);
  fs.writeFileSync(decisionMdPath, `${renderDecisionMarkdown(compatDecision)}\n`);
  return { adaptiveJsonPath, adaptiveMdPath, decisionJsonPath, decisionMdPath };
}

/**
 * Loads every input, ranks every candidate, builds both output documents, and writes all four output files.
 * This is the single entry point both the CLI and any other caller (e.g. tests) should use.
 * @param {{recommendationsPath?: string, historicalContextPath?: string, engineeringMemoryPath?: string, outputDir?: string}} [overrides]
 *   test-only escape hatch so this function's real logic can be exercised against isolated paths without
 *   needing a fresh module instance (mirrors every other engine's own main(overrides) precedent).
 * @returns {{adaptiveDecision: object, compatDecision: object, adaptiveJsonPath: string, adaptiveMdPath: string, decisionJsonPath: string, decisionMdPath: string}}
 */
function decide(overrides) {
  const opts = overrides || {};
  const sources = {
    recommendationsPath: opts.recommendationsPath || recommendationsPath,
    historicalContextPath: opts.historicalContextPath || historicalContextPath,
    engineeringMemoryPath: opts.engineeringMemoryPath || engineeringMemoryPath,
  };

  const recommendationsDoc = loadRecommendations(sources.recommendationsPath);
  const historicalContext = loadHistoricalContext(sources.historicalContextPath);
  const engineeringMemory = loadEngineeringMemory(sources.engineeringMemoryPath);

  const recommendations = recommendationsDoc.recommendations || [];
  const ranked = rankRecommendations(recommendations, historicalContext, engineeringMemory);
  const adaptiveDecision = buildAdaptiveDecision(recommendationsDoc, ranked, historicalContext, sources);
  const compatDecision = buildCompatDecision(ranked, adaptiveDecision, historicalContext !== null);

  const outputPaths = writeOutputs(adaptiveDecision, compatDecision, opts.outputDir);
  return { adaptiveDecision, compatDecision, ...outputPaths };
}

function main(overrides) {
  const result = decide(overrides);
  console.log(`Wrote ${path.relative(root, result.adaptiveJsonPath)}`);
  console.log(`Wrote ${path.relative(root, result.adaptiveMdPath)}`);
  console.log(`Wrote ${path.relative(root, result.decisionJsonPath)}`);
  console.log(`Wrote ${path.relative(root, result.decisionMdPath)}`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  root,
  recommendationsPath,
  historicalContextPath,
  engineeringMemoryPath,
  outputDir,
  WEIGHTS,
  SCORING_FORMULA_DESCRIPTION,
  loadRecommendations,
  loadHistoricalContext,
  loadEngineeringMemory,
  findMatchingHistoricalRuns,
  findEngineeringMemoryEntry,
  calculateRecommendationScore,
  calculateHistoricalScore,
  countHistoricalEvidence,
  calculateValidationScore,
  calculateFrequencyScore,
  calculateConfidenceScore,
  calculateFinalScore,
  rankRecommendations,
  selectBestRecommendation,
  calculateOverallConfidence,
  buildAdaptiveDecision,
  buildCompatDecision,
  renderAdaptiveDecisionMarkdown,
  renderDecisionMarkdown,
  writeOutputs,
  decide,
  main,
};
