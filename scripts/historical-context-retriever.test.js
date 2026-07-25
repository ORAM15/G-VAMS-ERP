#!/usr/bin/env node
// Historical Context Retriever v1 regression coverage.
//
// Uses Node's built-in `node:test` + `node:assert/strict` (zero new dependencies), the same deliberate
// deviation from "Jest tests" documented and used by Run History Manager v1 and Engineering Memory Engine
// v1's own test suites (no Jest anywhere in this repo; this gives the same describe/test/assert structure
// plus real, tool-reported coverage via `node --test --experimental-test-coverage`).
//
// Isolation: the real scripts/historical-context-retriever.js is required ONCE (not a fresh temp-copied
// module per test) -- every load/analyze function accepts explicit paths/dirs, so per-test isolation comes
// from pointing those at a fresh mkdtemp'd fixture root, keeping V8's coverage instrumentation attributing
// everything to one real file path (see engineering-memory.test.js's header for the full rationale).
//
// Run with:                         node scripts/historical-context-retriever.test.js
// Run with coverage:  node --test --experimental-test-coverage scripts/historical-context-retriever.test.js
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "scripts/historical-context-retriever.js"), "utf8");
const mod = require(path.join(repoRoot, "scripts/historical-context-retriever.js"));

function makeFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "historical-context-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function repositoryAnalysisFixture(overrides) {
  return {
    projectName: "G-VAMS-ERP",
    languages: [{ language: "JavaScript", fileCount: 100 }],
    frameworks: ["Express"],
    packageManagers: [],
    buildTools: [],
    importantDirectories: ["backend/controllers", "backend/middleware"],
    detectedModules: [
      { name: "Authentication", detected: true, confidence: "strong", evidence: ["backend/controllers/authController.js"] },
      { name: "Reports", detected: false, confidence: "none", evidence: [] },
    ],
    dependencyCount: { total: 10, perWorkspace: {} },
    fileCount: 100,
    technicalDebtIndicators: [],
    duplicateCandidates: [],
    largestFiles: [],
    architectureSummary: "G-VAMS-ERP is a JavaScript repository. Detected product modules: Authentication.",
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function metadataFixture(overrides) {
  return { runId: "RUN-000001", status: "SUCCESS", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z", durationMs: 500, goal: "Authentication security review", provider: "stub-deterministic-v1", profile: null, iterations: 1, ...overrides };
}
function decisionFixture(overrides) {
  return { selectedRecommendationId: 1, selectedTitle: "Extract Authentication logic into smaller units", ...overrides };
}
function validationFixture(overrides) {
  return {
    status: "approved",
    score: 95,
    approvedForPR: true,
    rules: [{ id: "RULE-001", description: "Execution completed successfully.", status: "PASS", details: "ok" }],
    ...overrides,
  };
}
function executionFixture(overrides) {
  return { status: "success", modifiedFiles: ["backend/controllers/authController.js"], testsExecuted: 2, testsPassed: 2, ...overrides };
}

// Writes a full, realistic archived run folder (the shape run-history-manager.js's ARTIFACT_MAP produces).
// Pass `null` for any field to simulate that file being missing (never written at all).
function writeRunFolder(runsDir, runId, fields) {
  const dir = path.join(runsDir, runId);
  const f = fields || {};
  if (f.metadata !== null) writeJson(path.join(dir, "metadata.json"), f.metadata ?? metadataFixture({ runId }));
  if (f.decision !== null) writeJson(path.join(dir, "decision.json"), f.decision ?? decisionFixture());
  if (f.validation !== null) writeJson(path.join(dir, "validation.json"), f.validation ?? validationFixture());
  if (f.execution !== null) writeJson(path.join(dir, "execution.json"), f.execution ?? executionFixture());
  if (f.repositoryAnalysis !== null) writeJson(path.join(dir, "repository-analysis.json"), f.repositoryAnalysis ?? repositoryAnalysisFixture());
  return dir;
}

describe("tokenize", () => {
  test("lowercases, splits on non-alphanumerics, drops short words and stopwords, and deduplicates", () => {
    assert.deepEqual(mod.tokenize("Authentication and the Authentication Module!"), ["authentication", "module"]);
  });

  test("returns an empty array for non-string or empty input", () => {
    assert.deepEqual(mod.tokenize(""), []);
    assert.deepEqual(mod.tokenize(null), []);
    assert.deepEqual(mod.tokenize(undefined), []);
  });
});

describe("selectQuery", () => {
  test("GVAMS_GOAL, when set and non-empty, always wins", () => {
    process.env.GVAMS_GOAL = "  Fix the login flow  ";
    try {
      assert.equal(mod.selectQuery(repositoryAnalysisFixture()), "Fix the login flow");
    } finally {
      delete process.env.GVAMS_GOAL;
    }
  });

  test("without a goal, picks the most strongly detected module (strong beats weak)", () => {
    delete process.env.GVAMS_GOAL;
    const analysis = repositoryAnalysisFixture({
      detectedModules: [
        { name: "Reports", detected: true, confidence: "weak", evidence: ["x.js"] },
        { name: "Authentication", detected: true, confidence: "strong", evidence: ["y.js"] },
      ],
    });
    assert.equal(mod.selectQuery(analysis), "Authentication");
  });

  test("ties within the same confidence are broken by evidence count, then name", () => {
    const analysis = repositoryAnalysisFixture({
      detectedModules: [
        { name: "Admin", detected: true, confidence: "strong", evidence: ["a.js"] },
        { name: "Faculty", detected: true, confidence: "strong", evidence: ["b.js", "c.js"] },
      ],
    });
    assert.equal(mod.selectQuery(analysis), "Faculty"); // more evidence files wins
  });

  test("falls back to projectName when nothing is detected, and to \"Unknown\" when there is no analysis at all", () => {
    assert.equal(mod.selectQuery(repositoryAnalysisFixture({ detectedModules: [] })), "G-VAMS-ERP");
    assert.equal(mod.selectQuery(null), "Unknown");
  });
});

describe("extractRepositoryTopics", () => {
  test("a full repository-analysis.json yields every topic field, including query in goalKeywords", () => {
    const topics = mod.extractRepositoryTopics(repositoryAnalysisFixture());
    assert.equal(topics.query, "Authentication");
    assert.deepEqual(topics.languages, ["JavaScript"]);
    assert.deepEqual(topics.frameworks, ["Express"]);
    assert.deepEqual(topics.componentNames, ["Authentication"]); // only detected:true modules
    assert.deepEqual(topics.directoryNames, ["backend/controllers", "backend/middleware"]);
    assert.ok(topics.goalKeywords.includes("authentication"));
  });

  test("a null repository-analysis.json degrades to an all-empty topic set, never a crash", () => {
    const topics = mod.extractRepositoryTopics(null);
    assert.equal(topics.query, "Unknown");
    assert.deepEqual(topics.languages, []);
    assert.deepEqual(topics.frameworks, []);
    assert.deepEqual(topics.componentNames, []);
    assert.deepEqual(topics.directoryNames, []);
  });
});

describe("loadRepositoryAnalysis / loadEngineeringMemory", () => {
  test("missing files yield null, never throw", () => {
    const fixtureRoot = makeFixtureRoot();
    assert.equal(mod.loadRepositoryAnalysis(path.join(fixtureRoot, "nope.json")), null);
    assert.equal(mod.loadEngineeringMemory(path.join(fixtureRoot, "nope.json")), null);
  });

  test("corrupted JSON yields null, never throws", () => {
    const fixtureRoot = makeFixtureRoot();
    const file = path.join(fixtureRoot, "bad.json");
    fs.writeFileSync(file, "{ not valid json !!");
    assert.equal(mod.loadRepositoryAnalysis(file), null);
    assert.equal(mod.loadEngineeringMemory(file), null);
  });

  test("valid files load and parse correctly", () => {
    const fixtureRoot = makeFixtureRoot();
    const analysisFile = path.join(fixtureRoot, "repository-analysis.json");
    writeJson(analysisFile, repositoryAnalysisFixture());
    assert.equal(mod.loadRepositoryAnalysis(analysisFile).projectName, "G-VAMS-ERP");

    const memoryFile = path.join(fixtureRoot, "engineering-memory.json");
    writeJson(memoryFile, { runsAnalyzed: 5 });
    assert.equal(mod.loadEngineeringMemory(memoryFile).runsAnalyzed, 5);
  });
});

describe("loadRunHistory: empty history", () => {
  test("a missing runs/ directory yields an empty array, not an error", () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    assert.deepEqual(mod.loadRunHistory(runsDir), []);
  });

  test("an existing but empty runs/ directory also yields an empty array", () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    fs.mkdirSync(runsDir, { recursive: true });
    assert.deepEqual(mod.loadRunHistory(runsDir), []);
  });
});

describe("loadRunHistory: single run", () => {
  test("loads every known archived file for one run folder, mapping repository-analysis.json to repositoryAnalysis", () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    writeRunFolder(runsDir, "RUN-000001");
    const runs = mod.loadRunHistory(runsDir);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, "RUN-000001");
    assert.equal(runs[0].metadata.status, "SUCCESS");
    assert.equal(runs[0].decision.selectedTitle, "Extract Authentication logic into smaller units");
    assert.equal(runs[0].validation.approvedForPR, true);
    assert.deepEqual(runs[0].execution.modifiedFiles, ["backend/controllers/authController.js"]);
    assert.equal(runs[0].repositoryAnalysis.projectName, "G-VAMS-ERP");
  });
});

describe("loadRunHistory: multiple runs", () => {
  test("loads every run folder in ascending run-id order, ignoring non-run entries", () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    writeRunFolder(runsDir, "RUN-000003", { metadata: metadataFixture({ runId: "RUN-000003" }) });
    writeRunFolder(runsDir, "RUN-000001", { metadata: metadataFixture({ runId: "RUN-000001" }) });
    fs.mkdirSync(path.join(runsDir, "not-a-run"), { recursive: true });
    fs.writeFileSync(path.join(runsDir, "RUN-000099"), "a file, not a directory");
    const runs = mod.loadRunHistory(runsDir);
    assert.deepEqual(runs.map((r) => r.runId), ["RUN-000001", "RUN-000003"]);
  });
});

describe("loadRunHistory: missing files", () => {
  test("a run missing several archived files has null for those fields, never an error", () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    writeRunFolder(runsDir, "RUN-000001", { decision: null, execution: null, repositoryAnalysis: null });
    const runs = mod.loadRunHistory(runsDir);
    assert.equal(runs[0].decision, null);
    assert.equal(runs[0].execution, null);
    assert.equal(runs[0].repositoryAnalysis, null);
    assert.equal(runs[0].metadata.status, "SUCCESS"); // the files that DO exist still load normally
  });
});

describe("loadRunHistory: corrupted files", () => {
  test("a file that exists but contains invalid JSON is treated exactly like a missing file (null), never throws", () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    const dir = path.join(runsDir, "RUN-000001");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "metadata.json"), "{ not valid JSON at all !!");
    fs.writeFileSync(path.join(dir, "validation.json"), JSON.stringify(validationFixture()));
    const runs = mod.loadRunHistory(runsDir);
    assert.equal(runs[0].metadata, null);
    assert.equal(runs[0].validation.approvedForPR, true);
  });
});

describe("scoreRunSimilarity", () => {
  const topics = {
    query: "Authentication",
    languages: ["JavaScript"],
    frameworks: ["Express"],
    componentNames: ["Authentication"],
    directoryNames: ["backend/controllers"],
    goalKeywords: ["authentication", "security"],
  };

  test("a run matching every criterion scores high (hand-computed: 0.96)", () => {
    const run = {
      execution: { modifiedFiles: ["backend/controllers/authController.js"] },
      decision: { selectedTitle: "Extract Authentication logic" },
      validation: { approvedForPR: true },
      repositoryAnalysis: {
        languages: [{ language: "JavaScript" }],
        frameworks: ["Express"],
        detectedModules: [{ name: "Authentication", detected: true }],
        importantDirectories: ["backend/controllers"],
      },
      metadata: { goal: "Authentication security review" },
    };
    // modifiedFiles=1, recommendation=1, validationOutcome=1, language=1, projectType=1, component=1,
    // directory=1, goal (Jaccard of {authentication,security,review} vs {authentication,security}) = 2/3.
    // mean = (7 + 2/3) / 8 = 0.958333... -> rounds to 0.96.
    assert.equal(mod.scoreRunSimilarity(run, topics), 0.96);
  });

  test("a run matching nothing scores exactly 0", () => {
    const run = {
      execution: { modifiedFiles: ["frontend/src/pages/Dashboard.js"] },
      decision: { selectedTitle: "Improve Reports rendering" },
      validation: null,
      repositoryAnalysis: {
        languages: [{ language: "Python" }],
        frameworks: ["Django"],
        detectedModules: [{ name: "Reports", detected: true }],
        importantDirectories: ["frontend/src/pages"],
      },
      metadata: { goal: "performance tuning" },
    };
    assert.equal(mod.scoreRunSimilarity(run, topics), 0);
  });

  test("a run with no repositoryAnalysis/execution/decision/validation archived at all scores 0, never throws", () => {
    assert.equal(mod.scoreRunSimilarity({}, topics), 0);
  });

  test("a validation outcome alone (no other overlap) contributes exactly 1/8 = 0.13 (rounded)", () => {
    const run = { validation: { approvedForPR: false } };
    assert.equal(mod.scoreRunSimilarity(run, topics), 0.13);
  });
});

describe("rankHistoricalEvidence / findRelevantRuns", () => {
  test("sorts descending by score, ties broken by descending run id, and respects the limit", () => {
    const scoredRuns = [
      { run: { runId: "RUN-000001" }, score: 0.5 },
      { run: { runId: "RUN-000002" }, score: 0.9 },
      { run: { runId: "RUN-000003" }, score: 0.9 },
    ];
    const ranked = mod.rankHistoricalEvidence(scoredRuns, 2);
    assert.deepEqual(ranked.map((r) => r.runId), ["RUN-000003", "RUN-000002"]);
  });

  test("findRelevantRuns excludes zero-score runs and summarizes the rest", () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    writeRunFolder(runsDir, "RUN-000001"); // relevant (Authentication)
    writeRunFolder(runsDir, "RUN-000002", {
      metadata: metadataFixture({ runId: "RUN-000002", goal: null }),
      decision: decisionFixture({ selectedTitle: "Improve Reports rendering" }),
      validation: null,
      execution: executionFixture({ modifiedFiles: ["frontend/src/pages/Dashboard.js"] }),
      repositoryAnalysis: repositoryAnalysisFixture({
        languages: [{ language: "Python", fileCount: 5 }],
        frameworks: ["Django"],
        detectedModules: [{ name: "Reports", detected: true, confidence: "strong", evidence: [] }],
        importantDirectories: ["frontend/src/pages"],
      }),
    });
    const runs = mod.loadRunHistory(runsDir);
    const topics = mod.extractRepositoryTopics(repositoryAnalysisFixture());
    const relevant = mod.findRelevantRuns(runs, topics);
    assert.deepEqual(relevant.map((r) => r.runId), ["RUN-000001"]);
    assert.equal(relevant[0].selectedTitle, "Extract Authentication logic into smaller units");
  });
});

describe("extractSuccessfulStrategies", () => {
  test("tallies selectedTitle only across SUCCESS matching runs, sorted by count desc then title asc", () => {
    const matchingRuns = [
      { status: "SUCCESS", selectedTitle: "Extract Auth" },
      { status: "SUCCESS", selectedTitle: "Extract Auth" },
      { status: "FAILED", selectedTitle: "Extract Auth" },
      { status: "SUCCESS", selectedTitle: "Reduce coupling" },
      { status: "SUCCESS", selectedTitle: null },
    ];
    assert.deepEqual(mod.extractSuccessfulStrategies(matchingRuns), [
      { title: "Extract Auth", count: 2 },
      { title: "Reduce coupling", count: 1 },
    ]);
  });

  test("respects the limit parameter", () => {
    const matchingRuns = ["B", "A", "C"].map((title) => ({ status: "SUCCESS", selectedTitle: title }));
    assert.equal(mod.extractSuccessfulStrategies(matchingRuns, 2).length, 2);
  });

  test("no successes at all yields an empty list, never fabricated", () => {
    assert.deepEqual(mod.extractSuccessfulStrategies([{ status: "FAILED", selectedTitle: "X" }]), []);
  });
});

describe("extractFailurePatterns", () => {
  test("tallies FAILed rule descriptions only for FAILED runs within the given matching run id set", () => {
    const runs = [
      { runId: "RUN-000001", metadata: { status: "FAILED" }, validation: { rules: [{ id: "RULE-004", description: "Tests passed.", status: "FAIL" }] } },
      { runId: "RUN-000002", metadata: { status: "FAILED" }, validation: { rules: [{ id: "RULE-004", description: "Tests passed.", status: "FAIL" }] } },
      { runId: "RUN-000003", metadata: { status: "SUCCESS" }, validation: { rules: [{ id: "RULE-002", description: "Only approved files modified.", status: "FAIL" }] } },
    ];
    const matchingRunIds = new Set(["RUN-000001", "RUN-000002", "RUN-000003"]);
    assert.deepEqual(mod.extractFailurePatterns(runs, matchingRunIds), [{ pattern: "Tests passed.", count: 2 }]);
  });

  test("ignores runs not in the matching set, never crashes on missing/null validation", () => {
    const runs = [
      { runId: "RUN-000001", metadata: { status: "FAILED" }, validation: { rules: [{ id: "X", description: "Not matching.", status: "FAIL" }] } },
      { runId: "RUN-000002", metadata: { status: "FAILED" }, validation: null },
      { runId: "RUN-000003", metadata: null, validation: { rules: [{ id: "Y", description: "No metadata.", status: "FAIL" }] } },
    ];
    assert.deepEqual(mod.extractFailurePatterns(runs, new Set(["RUN-000002", "RUN-000003"])), []);
  });
});

describe("calculateConfidence", () => {
  test("returns 0 for an empty matching-runs list, never a fabricated number", () => {
    assert.equal(mod.calculateConfidence([]), 0);
  });

  test("returns the mean of the matching runs' scores, rounded to 2 decimals", () => {
    assert.equal(mod.calculateConfidence([{ score: 1 }, { score: 0.5 }, { score: 0.75 }]), 0.75);
    assert.equal(mod.calculateConfidence([{ score: 1 }, { score: 1 }, { score: 0.8 }]), 0.93); // 2.8/3 = 0.9333...
  });
});

describe("buildHistoricalContext: successful retrieval", () => {
  test("a query-relevant, successful archived run produces non-empty matchingRuns/successfulRuns/recommendedStrategies", () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    writeRunFolder(runsDir, "RUN-000001");
    const runs = mod.loadRunHistory(runsDir);
    const repositoryAnalysis = repositoryAnalysisFixture();
    const context = mod.buildHistoricalContext({ repositoryAnalysis, engineeringMemory: null, runs });
    assert.equal(context.query, "Authentication");
    assert.equal(context.matchingRuns.length, 1);
    assert.equal(context.successfulRuns.length, 1);
    assert.equal(context.failedRuns.length, 0);
    assert.deepEqual(context.recommendedStrategies, [{ title: "Extract Authentication logic into smaller units", count: 1 }]);
    assert.deepEqual(context.avoidPatterns, []);
    assert.ok(context.confidence > 0);
    assert.equal(context.runsAnalyzed, 1);
  });
});

describe("buildHistoricalContext: failed retrieval", () => {
  test("a query-relevant, failed archived run produces failedRuns and avoidPatterns, not recommendedStrategies", () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    writeRunFolder(runsDir, "RUN-000001", {
      metadata: metadataFixture({ status: "FAILED" }),
      validation: validationFixture({ status: "rejected", score: 20, approvedForPR: false, rules: [{ id: "RULE-004", description: "Tests passed.", status: "FAIL", details: "1 of 2 failed" }] }),
    });
    const runs = mod.loadRunHistory(runsDir);
    const context = mod.buildHistoricalContext({ repositoryAnalysis: repositoryAnalysisFixture(), engineeringMemory: null, runs });
    assert.equal(context.matchingRuns.length, 1);
    assert.equal(context.successfulRuns.length, 0);
    assert.equal(context.failedRuns.length, 1);
    assert.deepEqual(context.recommendedStrategies, []);
    assert.deepEqual(context.avoidPatterns, [{ pattern: "Tests passed.", count: 1 }]);
  });
});

describe("buildHistoricalContext: engineering-memory fallback", () => {
  test("falls back to engineering-memory.json's global stats when no matching run offers its own strategy/pattern", () => {
    const engineeringMemory = {
      mostSuccessfulRecommendations: [{ title: "Extract Authentication logic into smaller units", successCount: 3, totalCount: 3 }],
      mostCommonFailureReasons: [{ reason: "Only approved files modified.", count: 2 }],
    };
    const context = mod.buildHistoricalContext({ repositoryAnalysis: repositoryAnalysisFixture(), engineeringMemory, runs: [] });
    assert.equal(context.matchingRuns.length, 0);
    assert.deepEqual(context.recommendedStrategies, [{ title: "Extract Authentication logic into smaller units", count: 3 }]);
    assert.deepEqual(context.avoidPatterns, [{ pattern: "Only approved files modified.", count: 2 }]);
    assert.equal(context.confidence, 0);
  });

  test("no engineering-memory.json and no matching runs yields honest empty lists, never fabricated", () => {
    const context = mod.buildHistoricalContext({ repositoryAnalysis: repositoryAnalysisFixture(), engineeringMemory: null, runs: [] });
    assert.deepEqual(context.matchingRuns, []);
    assert.deepEqual(context.recommendedStrategies, []);
    assert.deepEqual(context.avoidPatterns, []);
    assert.equal(context.confidence, 0);
  });
});

describe("missing files (whole-pipeline)", () => {
  test("a missing repository-analysis.json degrades to query \"Unknown\" (no GVAMS_GOAL) and empty topic-derived results, never throws", () => {
    delete process.env.GVAMS_GOAL;
    const context = mod.buildHistoricalContext({ repositoryAnalysis: null, engineeringMemory: null, runs: [] });
    assert.equal(context.query, "Unknown");
    assert.deepEqual(context.matchingRuns, []);
    assert.equal(context.confidence, 0);
  });
});

describe("corrupted files (whole-pipeline)", () => {
  test("retrieveSync never throws even when every input file is corrupted", () => {
    const fixtureRoot = makeFixtureRoot();
    const repositoryAnalysisPath = path.join(fixtureRoot, "repository-intelligence", "repository-analysis.json");
    fs.mkdirSync(path.dirname(repositoryAnalysisPath), { recursive: true });
    fs.writeFileSync(repositoryAnalysisPath, "{ corrupted !!");
    const engineeringMemoryPath = path.join(fixtureRoot, "memory", "engineering-memory.json");
    fs.mkdirSync(path.dirname(engineeringMemoryPath), { recursive: true });
    fs.writeFileSync(engineeringMemoryPath, "[ also corrupted");
    const runsDir = path.join(fixtureRoot, "runs");
    fs.mkdirSync(path.join(runsDir, "RUN-000001"), { recursive: true });
    fs.writeFileSync(path.join(runsDir, "RUN-000001", "metadata.json"), "not json {{{");
    const outputDir = path.join(fixtureRoot, "historical-context");

    const { context } = mod.retrieveSync({ repositoryAnalysisPath, engineeringMemoryPath, runsDir, outputDir });
    assert.equal(context.runsAnalyzed, 1);
    assert.equal(context.query, "Unknown");
  });
});

describe("report.md generation", () => {
  test("includes every required section", () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    writeRunFolder(runsDir, "RUN-000001");
    const runs = mod.loadRunHistory(runsDir);
    const context = mod.buildHistoricalContext({ repositoryAnalysis: repositoryAnalysisFixture(), engineeringMemory: null, runs });
    const markdown = mod.renderContextMarkdown(context);
    for (const heading of ["# Historical Context Report", "## Overview", "## Matching Runs", "## Recommended Strategies", "## Patterns To Avoid"]) {
      assert.ok(markdown.includes(heading), `expected report to include "${heading}"`);
    }
    assert.match(markdown, /RUN-000001/);
  });

  test("renders non-empty recommended strategies and patterns to avoid as bulleted lists", () => {
    const context = {
      query: "Authentication",
      matchingRuns: [],
      successfulRuns: [],
      failedRuns: [],
      recommendedStrategies: [{ title: "Extract Authentication logic", count: 2 }],
      avoidPatterns: [{ pattern: "Tests passed.", count: 1 }],
      confidence: 0.5,
      runsAnalyzed: 2,
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    const markdown = mod.renderContextMarkdown(context);
    assert.match(markdown, /- Extract Authentication logic \(2\)/);
    assert.match(markdown, /- Tests passed\. \(1\)/);
  });

  test("renders honest \"None\" placeholders for an empty history, never fabricated data", () => {
    const context = mod.buildHistoricalContext({ repositoryAnalysis: null, engineeringMemory: null, runs: [] });
    const markdown = mod.renderContextMarkdown(context);
    assert.match(markdown, /## Matching Runs\n\nNone/);
    assert.match(markdown, /## Recommended Strategies\n\nNone/);
    assert.match(markdown, /## Patterns To Avoid\n\nNone/);
  });
});

describe("async API (fs/promises)", () => {
  test("retrieve() (async) writes the same context as retrieveSync() for the same fixture", async () => {
    const runsDirSync = path.join(makeFixtureRoot(), "runs");
    writeRunFolder(runsDirSync, "RUN-000001");
    const repositoryAnalysisPath = path.join(path.dirname(runsDirSync), "repository-analysis.json");
    writeJson(repositoryAnalysisPath, repositoryAnalysisFixture());
    const outputDirSync = path.join(path.dirname(runsDirSync), "historical-context-sync");
    const syncResult = mod.retrieveSync({ repositoryAnalysisPath, runsDir: runsDirSync, outputDir: outputDirSync });

    const outputDirAsync = path.join(path.dirname(runsDirSync), "historical-context-async");
    const asyncResult = await mod.retrieve({ repositoryAnalysisPath, runsDir: runsDirSync, outputDir: outputDirAsync });

    assert.equal(asyncResult.context.query, syncResult.context.query);
    assert.equal(asyncResult.context.matchingRuns.length, syncResult.context.matchingRuns.length);
    assert.equal(asyncResult.context.confidence, syncResult.context.confidence);
    assert.equal(fs.existsSync(asyncResult.jsonPath), true);
    assert.equal(fs.existsSync(asyncResult.mdPath), true);
  });

  test("loadRunHistoryAsync produces the same result as loadRunHistory for the same fixture", async () => {
    const runsDir = path.join(makeFixtureRoot(), "runs");
    writeRunFolder(runsDir, "RUN-000001");
    writeRunFolder(runsDir, "RUN-000002", { metadata: metadataFixture({ runId: "RUN-000002", status: "FAILED" }) });
    const syncRuns = mod.loadRunHistory(runsDir);
    const asyncRuns = await mod.loadRunHistoryAsync(runsDir);
    assert.deepEqual(asyncRuns, syncRuns);
  });

  test("loadRepositoryAnalysisAsync/loadEngineeringMemoryAsync resolve to null for missing/corrupted files", async () => {
    const fixtureRoot = makeFixtureRoot();
    const missing = path.join(fixtureRoot, "nope.json");
    assert.equal(await mod.loadRepositoryAnalysisAsync(missing), null);
    assert.equal(await mod.loadEngineeringMemoryAsync(missing), null);
    const corrupted = path.join(fixtureRoot, "bad.json");
    fs.writeFileSync(corrupted, "not json");
    assert.equal(await mod.loadRepositoryAnalysisAsync(corrupted), null);
  });
});

describe("standalone CLI", () => {
  test("main() retrieves against an isolated set of paths when called directly (against the real module)", async () => {
    const fixtureRoot = makeFixtureRoot();
    const runsDir = path.join(fixtureRoot, "runs");
    writeRunFolder(runsDir, "RUN-000001");
    const repositoryAnalysisPath = path.join(fixtureRoot, "repository-analysis.json");
    writeJson(repositoryAnalysisPath, repositoryAnalysisFixture());
    const outputDir = path.join(fixtureRoot, "historical-context");
    const result = await mod.main({ repositoryAnalysisPath, runsDir, outputDir });
    assert.equal(result.context.runsAnalyzed, 1);
    assert.equal(fs.existsSync(path.join(outputDir, "historical-context.json")), true);
  });

  test("main() retrieves via the module's own configured default paths (real CLI subprocess)", () => {
    const fixtureRoot = makeFixtureRoot();
    fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "scripts/historical-context-retriever.js"), source);
    writeJson(path.join(fixtureRoot, "repository-intelligence", "repository-analysis.json"), repositoryAnalysisFixture());
    writeRunFolder(path.join(fixtureRoot, "runs"), "RUN-000001");

    const result = spawnSync("node", ["scripts/historical-context-retriever.js"], { cwd: fixtureRoot, encoding: "utf8" });
    assert.equal(result.status, 0, `expected the CLI to succeed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /matching run/);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "historical-context", "historical-context.json")), true);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "historical-context", "historical-context.md")), true);
  });

  test("the CLI succeeds even with no runs/ directory and no repository-analysis.json at all", () => {
    const fixtureRoot = makeFixtureRoot();
    fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "scripts/historical-context-retriever.js"), source);
    const result = spawnSync("node", ["scripts/historical-context-retriever.js"], { cwd: fixtureRoot, encoding: "utf8" });
    assert.equal(result.status, 0, `expected the CLI to succeed with nothing on disk:\n${result.stdout}\n${result.stderr}`);
    const context = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "historical-context", "historical-context.json"), "utf8"));
    assert.equal(context.runsAnalyzed, 0);
    assert.equal(context.query, "Unknown");
  });
});

describe("orchestrator integration (simulated real orchestrator-shaped call)", () => {
  test("accepts the exact {runsDir, outputDir} shape the orchestrator's runHistoricalContextStage() would call it with", () => {
    const fixtureRoot = makeFixtureRoot();
    const runsDir = path.join(fixtureRoot, "runs");
    writeRunFolder(runsDir, "RUN-000001");
    const outputDir = path.join(fixtureRoot, "historical-context");
    const result = mod.retrieveSync({ runsDir, outputDir });
    assert.equal(result.context.runsAnalyzed, 1);
    assert.equal(path.dirname(result.jsonPath), outputDir);
    assert.equal(fs.existsSync(result.jsonPath), true);
  });

  test("retrieveSync never throws for a runs/ directory that does not exist yet (a fresh repository)", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.retrieveSync({ runsDir: path.join(fixtureRoot, "runs"), outputDir: path.join(fixtureRoot, "historical-context") });
    assert.equal(result.context.runsAnalyzed, 0);
  });
});

console.log("All Historical Context Retriever v1 regression scenarios passed (run under node:test).");
