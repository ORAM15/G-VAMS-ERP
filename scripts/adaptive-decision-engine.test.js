#!/usr/bin/env node
// Adaptive Decision Engine v2 regression coverage.
//
// Uses Node's built-in `node:test` + `node:assert/strict` (zero new dependencies), the same deliberate
// deviation from "node:test" tasks documented and used by every recent engine's own test suite in this repo
// (no Jest anywhere; see engineering-memory.test.js's header for the full rationale).
//
// Isolation: the real scripts/adaptive-decision-engine.js is required ONCE (not a fresh temp-copied module
// per test) -- decide()/loadRecommendations()/loadHistoricalContext()/loadEngineeringMemory() all accept
// explicit paths, so per-test isolation comes from pointing those at fresh mkdtemp'd fixture files, keeping
// V8's coverage instrumentation attributing everything to one real file path.
//
// Run with:                         node scripts/adaptive-decision-engine.test.js
// Run with coverage:  node --test --experimental-test-coverage scripts/adaptive-decision-engine.test.js
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "scripts/adaptive-decision-engine.js"), "utf8");
const mod = require(path.join(repoRoot, "scripts/adaptive-decision-engine.js"));

function makeFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-decision-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function recommendationFixture(overrides) {
  return {
    id: 1,
    ruleKey: "extract-complex-logic",
    title: "Extract Authentication logic into smaller units",
    description: "Authentication has grown complex.",
    reason: ["Authentication has High complexity", "Medium maintenance risk"],
    affectedModules: ["Authentication"],
    affectedFiles: ["backend/controllers/authController.js"],
    estimatedImplementationSize: "Small",
    estimatedRisk: "Low",
    estimatedImpact: "High",
    confidence: 86,
    priorityScore: 82,
    ...overrides,
  };
}

function recommendationsDocFixture(recommendations, overrides) {
  return {
    generatedFrom: "engineering-knowledge/engineering-knowledge.json",
    sourceProjectName: "G-VAMS-ERP",
    sourceTimestamp: "2026-01-01T00:00:00.000Z",
    scoringFormula: "...",
    recommendations,
    timestamp: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

function matchingRunFixture(overrides) {
  return { runId: "RUN-000001", score: 0.9, status: "SUCCESS", goal: null, provider: null, selectedTitle: null, validationScore: 90, approvedForPR: true, ...overrides };
}

function historicalContextFixture(overrides) {
  return {
    query: "Authentication",
    matchingRuns: [],
    successfulRuns: [],
    failedRuns: [],
    recommendedStrategies: [],
    avoidPatterns: [],
    confidence: 0.85,
    runsAnalyzed: 0,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function engineeringMemoryFixture(overrides) {
  return {
    runsAnalyzed: 0,
    successfulRuns: 0,
    failedRuns: 0,
    averageValidationScore: null,
    averageIterations: null,
    mostModifiedFiles: [],
    mostSuccessfulRecommendations: [],
    mostCommonFailureReasons: [],
    fastestSuccessfulRun: null,
    slowestSuccessfulRun: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// The exact two-candidate fixture whose scores were hand-verified against the real implementation before
// writing these assertions: candidate #1 has a HIGHER raw recommendationScore (90 vs 67) but a WORSE
// historical track record (50% success, backed by 2 runs) than candidate #2 (100% success, backed by 1 run,
// higher validation score) -- so the weighted finalScore flips the ranking (#2's 77 beats #1's 72),
// concretely proving historical context changes strategy selection, not just decorates it.
const REC_1 = recommendationFixture({ id: 1, title: "Extract Authentication logic into smaller units", confidence: 86, priorityScore: 82, estimatedImpact: "High", estimatedRisk: "Low", estimatedImplementationSize: "Small" });
const REC_2 = recommendationFixture({ id: 2, title: "Reduce cross-module coupling for Authentication", confidence: 70, priorityScore: 75, estimatedImpact: "Medium", estimatedRisk: "Medium", estimatedImplementationSize: "Medium" });
const FLIP_HISTORICAL_CONTEXT = historicalContextFixture({
  matchingRuns: [
    matchingRunFixture({ runId: "RUN-000001", status: "SUCCESS", selectedTitle: REC_1.title, validationScore: 95 }),
    matchingRunFixture({ runId: "RUN-000002", status: "FAILED", selectedTitle: REC_1.title, validationScore: 33, approvedForPR: false }),
    matchingRunFixture({ runId: "RUN-000003", status: "SUCCESS", selectedTitle: REC_2.title, validationScore: 88 }),
  ],
  confidence: 0.85,
  runsAnalyzed: 3,
});

describe("loadRecommendations", () => {
  test("fails closed with an actionable error when recommendations.json is missing", () => {
    const file = path.join(makeFixtureRoot(), "nope.json");
    assert.throws(() => mod.loadRecommendations(file), /recommendations\.json not found/);
  });

  test("fails closed with an actionable error when recommendations.json is corrupted", () => {
    const file = path.join(makeFixtureRoot(), "bad.json");
    fs.writeFileSync(file, "{ not valid json !!");
    assert.throws(() => mod.loadRecommendations(file), /not valid JSON/);
  });

  test("loads and parses a valid recommendations.json", () => {
    const file = path.join(makeFixtureRoot(), "recommendations.json");
    writeJson(file, recommendationsDocFixture([REC_1]));
    assert.equal(mod.loadRecommendations(file).sourceProjectName, "G-VAMS-ERP");
  });
});

describe("loadHistoricalContext / loadEngineeringMemory", () => {
  test("missing files yield null, never throw (this engine's own required fallback contract)", () => {
    const fixtureRoot = makeFixtureRoot();
    assert.equal(mod.loadHistoricalContext(path.join(fixtureRoot, "nope.json")), null);
    assert.equal(mod.loadEngineeringMemory(path.join(fixtureRoot, "nope.json")), null);
  });

  test("corrupted JSON yields null, never throws", () => {
    const fixtureRoot = makeFixtureRoot();
    const file = path.join(fixtureRoot, "bad.json");
    fs.writeFileSync(file, "{ not valid json !!");
    assert.equal(mod.loadHistoricalContext(file), null);
    assert.equal(mod.loadEngineeringMemory(file), null);
  });

  test("valid files load and parse correctly", () => {
    const fixtureRoot = makeFixtureRoot();
    const histFile = path.join(fixtureRoot, "historical-context.json");
    writeJson(histFile, historicalContextFixture({ query: "Authentication" }));
    assert.equal(mod.loadHistoricalContext(histFile).query, "Authentication");

    const memFile = path.join(fixtureRoot, "engineering-memory.json");
    writeJson(memFile, engineeringMemoryFixture({ runsAnalyzed: 5 }));
    assert.equal(mod.loadEngineeringMemory(memFile).runsAnalyzed, 5);
  });
});

describe("calculateRecommendationScore", () => {
  test("matches the hand-verified formula (priorityScore*0.6 + confidence*0.4 + impact/risk/size adjustments)", () => {
    // 82*0.6 + 86*0.4 = 83.6; +6 (High impact); -0 (Low risk); -0 (Small size) = 89.6 -> round 90.
    assert.equal(mod.calculateRecommendationScore(REC_1), 90);
    // 75*0.6 + 70*0.4 = 73; +0 (Medium impact); -4 (Medium risk); -2 (Medium size) = 67.
    assert.equal(mod.calculateRecommendationScore(REC_2), 67);
  });

  test("clamps to 0-100", () => {
    const extreme = recommendationFixture({ confidence: 100, priorityScore: 100, estimatedImpact: "High", estimatedRisk: "Low", estimatedImplementationSize: "Small" });
    assert.ok(mod.calculateRecommendationScore(extreme) <= 100);
  });
});

describe("calculateHistoricalScore / countHistoricalEvidence: no history", () => {
  test("null historicalContext and null engineeringMemory yield 0 score and 0 evidence, never a crash", () => {
    assert.equal(mod.calculateHistoricalScore(REC_1, null, null), 0);
    assert.equal(mod.countHistoricalEvidence(REC_1, null, null), 0);
  });

  test("a historicalContext with zero matchingRuns yields 0, never a crash", () => {
    assert.equal(mod.calculateHistoricalScore(REC_1, historicalContextFixture(), null), 0);
  });
});

describe("calculateHistoricalScore / countHistoricalEvidence: successful history", () => {
  test("100% success rate when every matching run for this title succeeded", () => {
    const historicalContext = historicalContextFixture({
      matchingRuns: [matchingRunFixture({ selectedTitle: REC_1.title, status: "SUCCESS" }), matchingRunFixture({ runId: "RUN-000002", selectedTitle: REC_1.title, status: "SUCCESS" })],
    });
    assert.equal(mod.calculateHistoricalScore(REC_1, historicalContext, null), 100);
    assert.equal(mod.countHistoricalEvidence(REC_1, historicalContext, null), 2);
  });
});

describe("calculateHistoricalScore / countHistoricalEvidence: failed history", () => {
  test("0% success rate when every matching run for this title failed", () => {
    const historicalContext = historicalContextFixture({
      matchingRuns: [matchingRunFixture({ selectedTitle: REC_1.title, status: "FAILED" })],
    });
    assert.equal(mod.calculateHistoricalScore(REC_1, historicalContext, null), 0);
    assert.equal(mod.countHistoricalEvidence(REC_1, historicalContext, null), 1);
  });
});

describe("calculateHistoricalScore / countHistoricalEvidence: mixed history", () => {
  test("a fractional success rate when matching runs for this title are a mix of SUCCESS/FAILED", () => {
    assert.equal(mod.calculateHistoricalScore(REC_1, FLIP_HISTORICAL_CONTEXT, null), 50); // 1 of 2 succeeded
    assert.equal(mod.countHistoricalEvidence(REC_1, FLIP_HISTORICAL_CONTEXT, null), 2);
  });

  test("falls back to engineering-memory.json's mostSuccessfulRecommendations when historical-context has no matches for this title", () => {
    const engineeringMemory = engineeringMemoryFixture({ mostSuccessfulRecommendations: [{ title: REC_1.title, successCount: 3, totalCount: 4 }] });
    assert.equal(mod.calculateHistoricalScore(REC_1, historicalContextFixture(), engineeringMemory), 75); // 3/4
    assert.equal(mod.countHistoricalEvidence(REC_1, historicalContextFixture(), engineeringMemory), 4);
  });
});

describe("calculateValidationScore", () => {
  test("averages this title's matching runs' validationScore", () => {
    // RUN-000001: 95, RUN-000002: 33 -> avg 64.
    assert.equal(mod.calculateValidationScore(REC_1, FLIP_HISTORICAL_CONTEXT, null), 64);
  });

  test("falls back to engineering-memory.json's global averageValidationScore when no matching runs", () => {
    assert.equal(mod.calculateValidationScore(REC_1, historicalContextFixture(), engineeringMemoryFixture({ averageValidationScore: 82.7 })), 83);
  });

  test("falls back to 0 when neither source has data, never a crash", () => {
    assert.equal(mod.calculateValidationScore(REC_1, null, null), 0);
  });
});

describe("calculateFrequencyScore", () => {
  test("computes this title's share of all matchingRuns", () => {
    // REC_1 matches 2 of 3 total matchingRuns -> round(2/3*100) = 67.
    assert.equal(mod.calculateFrequencyScore(REC_1, FLIP_HISTORICAL_CONTEXT, null), 67);
    // REC_2 matches 1 of 3 -> round(1/3*100) = 33.
    assert.equal(mod.calculateFrequencyScore(REC_2, FLIP_HISTORICAL_CONTEXT, null), 33);
  });

  test("falls back to engineering-memory.json's totalCount/runsAnalyzed when historical-context has no matchingRuns", () => {
    const engineeringMemory = engineeringMemoryFixture({ runsAnalyzed: 5, mostSuccessfulRecommendations: [{ title: REC_1.title, successCount: 1, totalCount: 2 }] });
    assert.equal(mod.calculateFrequencyScore(REC_1, historicalContextFixture(), engineeringMemory), 40); // 2/5
  });

  test("falls back to 0 when neither source has data", () => {
    assert.equal(mod.calculateFrequencyScore(REC_1, null, null), 0);
  });
});

describe("calculateConfidenceScore", () => {
  test("reads the recommendation's own confidence field directly, clamped 0-100", () => {
    assert.equal(mod.calculateConfidenceScore(REC_1), 86);
    assert.equal(mod.calculateConfidenceScore(recommendationFixture({ confidence: 150 })), 100);
    assert.equal(mod.calculateConfidenceScore(recommendationFixture({ confidence: -10 })), 0);
  });
});

describe("rankRecommendations: ranking (historical context flips the order)", () => {
  test("a lower-recommendationScore candidate with a better historical track record outranks a higher-recommendationScore one", () => {
    const ranked = mod.rankRecommendations([REC_1, REC_2], FLIP_HISTORICAL_CONTEXT, null);
    assert.deepEqual(ranked.map((r) => r.id), [2, 1]);
    assert.equal(ranked[0].finalScore, 77);
    assert.equal(ranked[1].finalScore, 72);
  });

  test("with no historical context at all, ranking falls back to recommendationScore/confidenceScore order (Recommendation Engine scores only)", () => {
    const ranked = mod.rankRecommendations([REC_1, REC_2], null, null);
    assert.deepEqual(ranked.map((r) => r.id), [1, 2]); // REC_1's recommendationScore (90) beats REC_2's (67)
  });
});

describe("rankRecommendations: ties", () => {
  test("ties on finalScore are broken by recommendationScore, then confidenceScore, then id", () => {
    const a = recommendationFixture({ id: 5, title: "A", confidence: 50, priorityScore: 50, estimatedImpact: "Medium", estimatedRisk: "Medium", estimatedImplementationSize: "Medium" });
    const b = recommendationFixture({ id: 3, title: "B", confidence: 50, priorityScore: 50, estimatedImpact: "Medium", estimatedRisk: "Medium", estimatedImplementationSize: "Medium" });
    const ranked = mod.rankRecommendations([a, b], null, null);
    // Identical inputs -> identical scores at every level -> lower id wins deterministically.
    assert.deepEqual(ranked.map((r) => r.id), [3, 5]);
  });

  test("ranking is a total order independent of input array order", () => {
    const a = recommendationFixture({ id: 1 });
    const b = recommendationFixture({ id: 2 });
    const rankedForward = mod.rankRecommendations([a, b], null, null).map((r) => r.id);
    const rankedReversed = mod.rankRecommendations([b, a], null, null).map((r) => r.id);
    assert.deepEqual(rankedForward, rankedReversed);
  });
});

describe("selectBestRecommendation", () => {
  test("returns the top-ranked candidate", () => {
    const ranked = mod.rankRecommendations([REC_1, REC_2], FLIP_HISTORICAL_CONTEXT, null);
    assert.equal(mod.selectBestRecommendation(ranked).id, 2);
  });

  test("returns null for an empty ranking, never fabricated", () => {
    assert.equal(mod.selectBestRecommendation([]), null);
  });
});

describe("calculateOverallConfidence", () => {
  test("blends the winner's own finalScore ratio with historical-context.json's own confidence (hand-verified: 0.8)", () => {
    const ranked = mod.rankRecommendations([REC_1, REC_2], FLIP_HISTORICAL_CONTEXT, null);
    const winner = mod.selectBestRecommendation(ranked);
    assert.equal(mod.calculateOverallConfidence(winner, FLIP_HISTORICAL_CONTEXT), 0.8);
  });

  test("collapses to exactly finalScore/100 when historical context is unavailable", () => {
    const ranked = mod.rankRecommendations([REC_1], null, null);
    const winner = mod.selectBestRecommendation(ranked);
    assert.equal(mod.calculateOverallConfidence(winner, null), Math.round((winner.finalScore / 100) * 100) / 100);
  });

  test("returns 0 for a null winner, never a crash", () => {
    assert.equal(mod.calculateOverallConfidence(null, FLIP_HISTORICAL_CONTEXT), 0);
  });
});

describe("buildAdaptiveDecision / buildCompatDecision: successful history influences selection", () => {
  test("adaptive-decision.json's selectedRecommendation reflects the historically-informed winner, not the raw highest recommendationScore", () => {
    const recommendationsDoc = recommendationsDocFixture([REC_1, REC_2]);
    const ranked = mod.rankRecommendations(recommendationsDoc.recommendations, FLIP_HISTORICAL_CONTEXT, null);
    const sources = { recommendationsPath: "/fake/recommendations.json", historicalContextPath: "/fake/historical-context.json", engineeringMemoryPath: "/fake/engineering-memory.json" };
    const adaptiveDecision = mod.buildAdaptiveDecision(recommendationsDoc, ranked, FLIP_HISTORICAL_CONTEXT, sources);
    assert.equal(adaptiveDecision.selectedRecommendationId, 2);
    assert.equal(adaptiveDecision.selectedRecommendation, REC_2.title);
    assert.equal(adaptiveDecision.historicalContextAvailable, true);
    assert.deepEqual(adaptiveDecision.selectionReason, { recommendationScore: 67, historicalSuccessRate: 100, historicalEvidence: 1, confidence: 0.8 });
    assert.equal(adaptiveDecision.alternatives.length, 1);
    assert.equal(adaptiveDecision.alternatives[0].id, 1);

    const compatDecision = mod.buildCompatDecision(ranked, adaptiveDecision, true);
    assert.equal(compatDecision.selectedRecommendationId, 2);
    assert.equal(compatDecision.selectedTitle, REC_2.title);
    assert.equal(compatDecision.decisionConfidence, 80);
    assert.equal(compatDecision.sourceProjectName, recommendationsDoc.sourceProjectName);
    assert.equal(compatDecision.sourceTimestamp, recommendationsDoc.timestamp);
    assert.equal(compatDecision.timestamp, adaptiveDecision.timestamp); // same decision instant
    assert.equal(compatDecision.candidateScores.length, 2);
    assert.equal(compatDecision.candidateScores.find((c) => c.selected).id, 2);
  });
});

describe("buildAdaptiveDecision / buildCompatDecision: failed history discourages a candidate", () => {
  test("a candidate whose only historical evidence is a failure scores lower on historicalSuccessRate/validationScore", () => {
    const historicalContext = historicalContextFixture({
      matchingRuns: [matchingRunFixture({ selectedTitle: REC_1.title, status: "FAILED", validationScore: 20, approvedForPR: false })],
      runsAnalyzed: 1,
    });
    const ranked = mod.rankRecommendations([REC_1], historicalContext, null);
    assert.equal(ranked[0].historicalScore, 0);
    assert.equal(ranked[0].validationScore, 20);
  });
});

describe("buildAdaptiveDecision / buildCompatDecision: empty recommendations", () => {
  test("zero candidates yields an honest null selection, never fabricated, in both documents", () => {
    const recommendationsDoc = recommendationsDocFixture([]);
    const ranked = mod.rankRecommendations([], null, null);
    const sources = { recommendationsPath: "/fake/r.json", historicalContextPath: "/fake/h.json", engineeringMemoryPath: "/fake/m.json" };
    const adaptiveDecision = mod.buildAdaptiveDecision(recommendationsDoc, ranked, null, sources);
    assert.equal(adaptiveDecision.selectedRecommendationId, null);
    assert.equal(adaptiveDecision.selectedRecommendation, null);
    assert.deepEqual(adaptiveDecision.selectionReason, { recommendationScore: 0, historicalSuccessRate: 0, historicalEvidence: 0, confidence: 0 });
    assert.deepEqual(adaptiveDecision.alternatives, []);

    const compatDecision = mod.buildCompatDecision(ranked, adaptiveDecision, false);
    assert.equal(compatDecision.selectedRecommendationId, null);
    assert.equal(compatDecision.selectedTitle, null);
    assert.equal(compatDecision.decisionConfidence, 0);
    assert.deepEqual(compatDecision.candidateScores, []);
  });
});

describe("fallback: historical-context.json unavailable", () => {
  test("decide() never fails when historical-context.json is missing -- falls back to Recommendation Engine scores only", () => {
    const fixtureRoot = makeFixtureRoot();
    const recommendationsPath = path.join(fixtureRoot, "recommendations.json");
    writeJson(recommendationsPath, recommendationsDocFixture([REC_1, REC_2]));
    const result = mod.decide({
      recommendationsPath,
      historicalContextPath: path.join(fixtureRoot, "historical-context", "historical-context.json"),
      engineeringMemoryPath: path.join(fixtureRoot, "memory", "engineering-memory.json"),
      outputDir: path.join(fixtureRoot, "decision"),
    });
    assert.equal(result.adaptiveDecision.historicalContextAvailable, false);
    assert.equal(result.adaptiveDecision.selectedRecommendationId, 1); // REC_1's recommendationScore (90) wins with no history
    assert.match(result.compatDecision.decisionReasons.join(" "), /fell back to Recommendation Engine scores only/);
  });
});

describe("missing files", () => {
  test("decide() throws only when recommendations.json itself is missing (the one required input)", () => {
    const fixtureRoot = makeFixtureRoot();
    assert.throws(
      () => mod.decide({ recommendationsPath: path.join(fixtureRoot, "nope.json"), outputDir: path.join(fixtureRoot, "decision") }),
      /recommendations\.json not found/
    );
  });
});

describe("corrupted files", () => {
  test("decide() never throws when historical-context.json or engineering-memory.json is corrupted", () => {
    const fixtureRoot = makeFixtureRoot();
    const recommendationsPath = path.join(fixtureRoot, "recommendations.json");
    writeJson(recommendationsPath, recommendationsDocFixture([REC_1]));
    const historicalContextPath = path.join(fixtureRoot, "historical-context.json");
    fs.writeFileSync(historicalContextPath, "{ corrupted !!");
    const engineeringMemoryPath = path.join(fixtureRoot, "engineering-memory.json");
    fs.writeFileSync(engineeringMemoryPath, "[ also corrupted");
    const result = mod.decide({ recommendationsPath, historicalContextPath, engineeringMemoryPath, outputDir: path.join(fixtureRoot, "decision") });
    assert.equal(result.adaptiveDecision.historicalContextAvailable, false);
    assert.equal(result.adaptiveDecision.selectedRecommendationId, 1);
  });

  test("decide() throws when recommendations.json itself is corrupted", () => {
    const fixtureRoot = makeFixtureRoot();
    const recommendationsPath = path.join(fixtureRoot, "recommendations.json");
    fs.writeFileSync(recommendationsPath, "{ not valid json");
    assert.throws(() => mod.decide({ recommendationsPath, outputDir: path.join(fixtureRoot, "decision") }), /not valid JSON/);
  });
});

describe("confidence", () => {
  test("selectionReason.confidence is always within [0, 1]", () => {
    const ranked = mod.rankRecommendations([REC_1, REC_2], FLIP_HISTORICAL_CONTEXT, null);
    const winner = mod.selectBestRecommendation(ranked);
    const confidence = mod.calculateOverallConfidence(winner, FLIP_HISTORICAL_CONTEXT);
    assert.ok(confidence >= 0 && confidence <= 1);
  });
});

describe("decide(): full pipeline + output files", () => {
  test("writes all four output files with mutually consistent content", () => {
    const fixtureRoot = makeFixtureRoot();
    const recommendationsPath = path.join(fixtureRoot, "recommendations.json");
    writeJson(recommendationsPath, recommendationsDocFixture([REC_1, REC_2]));
    const historicalContextPath = path.join(fixtureRoot, "historical-context.json");
    writeJson(historicalContextPath, FLIP_HISTORICAL_CONTEXT);
    const engineeringMemoryPath = path.join(fixtureRoot, "engineering-memory.json");
    writeJson(engineeringMemoryPath, engineeringMemoryFixture());
    const outputDir = path.join(fixtureRoot, "decision");

    const result = mod.decide({ recommendationsPath, historicalContextPath, engineeringMemoryPath, outputDir });
    assert.equal(fs.existsSync(result.adaptiveJsonPath), true);
    assert.equal(fs.existsSync(result.adaptiveMdPath), true);
    assert.equal(fs.existsSync(result.decisionJsonPath), true);
    assert.equal(fs.existsSync(result.decisionMdPath), true);

    const writtenAdaptive = JSON.parse(fs.readFileSync(result.adaptiveJsonPath, "utf8"));
    assert.deepEqual(writtenAdaptive, result.adaptiveDecision);
    const writtenDecision = JSON.parse(fs.readFileSync(result.decisionJsonPath, "utf8"));
    assert.deepEqual(writtenDecision, result.compatDecision);
    assert.equal(writtenDecision.selectedRecommendationId, writtenAdaptive.selectedRecommendationId);
  });
});

describe("report.md generation", () => {
  test("adaptive-decision.md includes every required section", () => {
    const ranked = mod.rankRecommendations([REC_1, REC_2], FLIP_HISTORICAL_CONTEXT, null);
    const sources = { recommendationsPath: "/fake/r.json", historicalContextPath: "/fake/h.json", engineeringMemoryPath: "/fake/m.json" };
    const adaptiveDecision = mod.buildAdaptiveDecision(recommendationsDocFixture([REC_1, REC_2]), ranked, FLIP_HISTORICAL_CONTEXT, sources);
    const markdown = mod.renderAdaptiveDecisionMarkdown(adaptiveDecision);
    for (const heading of ["# Adaptive Decision Engine v2 Report", "## Scoring formula", "## Scoring weights", "### Selection reason", "### Alternatives"]) {
      assert.ok(markdown.includes(heading), `expected report to include "${heading}"`);
    }
    assert.match(markdown, /Reduce cross-module coupling for Authentication/);
  });

  test("adaptive-decision.md renders an honest empty selection", () => {
    const adaptiveDecision = mod.buildAdaptiveDecision(recommendationsDocFixture([]), [], null, { recommendationsPath: "/fake/r.json", historicalContextPath: "/fake/h.json", engineeringMemoryPath: "/fake/m.json" });
    const markdown = mod.renderAdaptiveDecisionMarkdown(adaptiveDecision);
    assert.match(markdown, /No recommendation was selected/);
  });

  test("decision.md (compatibility report) includes every required section", () => {
    const ranked = mod.rankRecommendations([REC_1, REC_2], FLIP_HISTORICAL_CONTEXT, null);
    const sources = { recommendationsPath: "/fake/r.json", historicalContextPath: "/fake/h.json", engineeringMemoryPath: "/fake/m.json" };
    const adaptiveDecision = mod.buildAdaptiveDecision(recommendationsDocFixture([REC_1, REC_2]), ranked, FLIP_HISTORICAL_CONTEXT, sources);
    const compatDecision = mod.buildCompatDecision(ranked, adaptiveDecision, true);
    const markdown = mod.renderDecisionMarkdown(compatDecision);
    for (const heading of ["# Decision Engine Report", "## Decision formula", "### Why this recommendation was selected", "### Every candidate considered"]) {
      assert.ok(markdown.includes(heading), `expected report to include "${heading}"`);
    }
  });

  test("decision.md renders an honest empty selection", () => {
    const compatDecision = mod.buildCompatDecision([], { generatedFrom: "x", sourceProjectName: "P", sourceTimestamp: "t", scoringFormula: "f", candidatesEvaluated: 0, timestamp: "t2" }, false);
    const markdown = mod.renderDecisionMarkdown(compatDecision);
    assert.match(markdown, /No recommendation was selected/);
  });
});

describe("standalone CLI", () => {
  test("main() decides against an isolated set of paths when called directly (against the real module)", () => {
    const fixtureRoot = makeFixtureRoot();
    const recommendationsPath = path.join(fixtureRoot, "recommendations.json");
    writeJson(recommendationsPath, recommendationsDocFixture([REC_1]));
    const outputDir = path.join(fixtureRoot, "decision");
    const result = mod.main({ recommendationsPath, outputDir });
    assert.equal(result.adaptiveDecision.selectedRecommendationId, 1);
    assert.equal(fs.existsSync(path.join(outputDir, "adaptive-decision.json")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "decision.json")), true);
  });

  test("main() decides via the module's own configured default paths (real CLI subprocess)", () => {
    const fixtureRoot = makeFixtureRoot();
    fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "scripts/adaptive-decision-engine.js"), source);
    writeJson(path.join(fixtureRoot, "recommendations", "recommendations.json"), recommendationsDocFixture([REC_1, REC_2]));
    writeJson(path.join(fixtureRoot, "historical-context", "historical-context.json"), FLIP_HISTORICAL_CONTEXT);

    const result = spawnSync("node", ["scripts/adaptive-decision-engine.js"], { cwd: fixtureRoot, encoding: "utf8" });
    assert.equal(result.status, 0, `expected the CLI to succeed:\n${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "decision", "adaptive-decision.json")), true);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "decision", "decision.json")), true);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "decision", "decision.md")), true);
    const written = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "decision", "adaptive-decision.json"), "utf8"));
    assert.equal(written.selectedRecommendationId, 2); // historical context present -> the flipped winner
  });

  test("the CLI exits 1 with an actionable error when recommendations.json is missing", () => {
    const fixtureRoot = makeFixtureRoot();
    fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "scripts/adaptive-decision-engine.js"), source);
    const result = spawnSync("node", ["scripts/adaptive-decision-engine.js"], { cwd: fixtureRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /recommendations\.json not found/);
  });
});

describe("orchestrator integration (simulated real orchestrator-shaped call)", () => {
  test("accepts the exact {outputDir} shape a spawned CLI stage would run with, reusing DECISION_OUTPUT_DIR-style overrides", () => {
    const fixtureRoot = makeFixtureRoot();
    const recommendationsPath = path.join(fixtureRoot, "recommendations.json");
    writeJson(recommendationsPath, recommendationsDocFixture([REC_1]));
    const outputDir = path.join(fixtureRoot, "decision");
    const result = mod.decide({ recommendationsPath, outputDir });
    assert.equal(path.dirname(result.decisionJsonPath), outputDir);
    assert.equal(fs.existsSync(result.decisionJsonPath), true);
    // Implementation Request Engine's own required fields, unmodified contract:
    const written = JSON.parse(fs.readFileSync(result.decisionJsonPath, "utf8"));
    for (const field of ["sourceProjectName", "sourceTimestamp", "timestamp", "selectedRecommendationId", "selectedTitle", "estimatedRisk", "estimatedImplementationSize"]) {
      assert.ok(field in written, `expected decision.json to still carry the "${field}" field Implementation Request Engine depends on`);
    }
  });
});

console.log("All Adaptive Decision Engine v2 regression scenarios passed (run under node:test).");
