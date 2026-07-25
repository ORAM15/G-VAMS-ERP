#!/usr/bin/env node
// Engineering Memory Engine v1 regression coverage.
//
// Uses Node's built-in `node:test` + `node:assert/strict` (zero new dependencies), matching the precedent
// set by Run History Manager v1's own test suite -- see that file's header comment for why (no Jest
// anywhere in this repo; this gives the same describe/test/assert structure plus real, tool-reported
// coverage via `node --test --experimental-test-coverage`).
//
// Isolation: the real scripts/engineering-memory.js is required ONCE (not a fresh temp-copied module per
// test) -- loadRuns/analyzeSync/analyze all accept an explicit runsDir/outputDir, so per-test isolation
// comes from pointing those at a fresh mkdtemp'd directory, keeping V8's coverage instrumentation
// attributing everything to one real file path.
//
// Run with:                         node scripts/engineering-memory.test.js
// Run with coverage:  node --test --experimental-test-coverage scripts/engineering-memory.test.js
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "scripts/engineering-memory.js"), "utf8");
const mod = require(path.join(repoRoot, "scripts/engineering-memory.js"));

function makeRunsDir() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "engineering-memory-")), "runs");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

const BASE_RULES = [
  { id: "RULE-001", description: "Execution completed successfully.", status: "PASS", details: "ok" },
  { id: "RULE-002", description: "Only approved files modified.", status: "PASS", details: "ok" },
  { id: "RULE-006", description: "Execution policy respected.", status: "PASS", details: "ok" },
];

function metadataFixture(overrides) {
  return { runId: "RUN-000001", status: "SUCCESS", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z", durationMs: 500, goal: null, provider: "stub-deterministic-v1", profile: null, iterations: 1, ...overrides };
}
function metricsFixture(overrides) {
  return { iterations: 1, retryCount: 0, artifactsArchived: 9, validationPassed: true, validationScore: 95, reflectionRetryRecommended: false, durationMs: 500, ...overrides };
}
function decisionFixture(overrides) {
  return { selectedRecommendationId: 1, selectedTitle: "Extract Authentication logic into smaller units", ...overrides };
}
function validationFixture(overrides) {
  return { status: "approved", score: 95, approvedForPR: true, rules: BASE_RULES.map((r) => ({ ...r })), ...overrides };
}
function executionFixture(overrides) {
  return { status: "success", modifiedFiles: ["backend/controllers/authController.js", "backend/middleware/authMiddleware.js"], testsExecuted: 2, testsPassed: 2, ...overrides };
}
function reflectionFixture(overrides) {
  return { retryRecommended: false, reason: "Validation approved this change for a pull request; no further implementation attempt is needed.", failedRules: [], ...overrides };
}
function timelineFixture() {
  return [{ stage: "Repository Intelligence", durationMs: 100 }];
}

// Writes a full, realistic run folder. Pass `null` for any field to simulate that file being missing
// (never written at all) -- distinct from passing a deliberately corrupted raw string via writeRunFolderRaw.
function writeRunFolder(runsDir, runId, fields) {
  const dir = path.join(runsDir, runId);
  const f = fields || {};
  if (f.metadata !== null) writeJson(path.join(dir, "metadata.json"), f.metadata ?? metadataFixture({ runId }));
  if (f.metrics !== null) writeJson(path.join(dir, "metrics.json"), f.metrics ?? metricsFixture());
  if (f.timeline !== null) writeJson(path.join(dir, "timeline.json"), f.timeline ?? timelineFixture());
  if (f.decision !== null) writeJson(path.join(dir, "decision.json"), f.decision ?? decisionFixture());
  if (f.validation !== null) writeJson(path.join(dir, "validation.json"), f.validation ?? validationFixture());
  if (f.reflection !== null) writeJson(path.join(dir, "reflection.json"), f.reflection ?? reflectionFixture());
  if (f.execution !== null) writeJson(path.join(dir, "execution.json"), f.execution ?? executionFixture());
  if (f.runSummary !== null) writeText(path.join(dir, "run-summary.md"), f.runSummary ?? "# Run Summary\n");
  return dir;
}

describe("loadRuns: empty runs directory", () => {
  test("a missing runs/ directory yields an empty array, not an error", () => {
    const runsDir = makeRunsDir();
    assert.deepEqual(mod.loadRuns(runsDir), []);
  });

  test("an existing but empty runs/ directory also yields an empty array", () => {
    const runsDir = makeRunsDir();
    fs.mkdirSync(runsDir, { recursive: true });
    assert.deepEqual(mod.loadRuns(runsDir), []);
  });

  test("buildEngineeringMemory on zero runs produces honest empty/null values, never fabricated", () => {
    const memory = mod.buildEngineeringMemory([]);
    assert.equal(memory.runsAnalyzed, 0);
    assert.equal(memory.successfulRuns, 0);
    assert.equal(memory.failedRuns, 0);
    assert.equal(memory.averageValidationScore, null);
    assert.equal(memory.averageIterations, null);
    assert.deepEqual(memory.mostModifiedFiles, []);
    assert.deepEqual(memory.mostSuccessfulRecommendations, []);
    assert.deepEqual(memory.mostCommonFailureReasons, []);
    assert.equal(memory.fastestSuccessfulRun, null);
    assert.equal(memory.slowestSuccessfulRun, null);
  });
});

describe("loadRuns: one successful run", () => {
  test("loads every known file for a single, complete run folder", () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001");
    const runs = mod.loadRuns(runsDir);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, "RUN-000001");
    assert.equal(runs[0].metadata.status, "SUCCESS");
    assert.equal(runs[0].decision.selectedTitle, "Extract Authentication logic into smaller units");
    assert.equal(runs[0].validation.score, 95);
    assert.ok(runs[0].runSummary.includes("# Run Summary"));
  });

  test("analyzeSync produces a fully consistent engineering-memory.json for one successful run", () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001");
    const outputDir = path.join(path.dirname(runsDir), "memory");
    const { memory, jsonPath, mdPath } = mod.analyzeSync({ runsDir, outputDir });
    assert.equal(memory.runsAnalyzed, 1);
    assert.equal(memory.successfulRuns, 1);
    assert.equal(memory.failedRuns, 0);
    assert.equal(memory.averageValidationScore, 95);
    assert.equal(memory.averageIterations, 1);
    assert.equal(memory.fastestSuccessfulRun.runId, "RUN-000001");
    assert.equal(memory.slowestSuccessfulRun.runId, "RUN-000001");
    assert.equal(fs.existsSync(jsonPath), true);
    assert.equal(fs.existsSync(mdPath), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(jsonPath, "utf8")), memory);
  });
});

describe("loadRuns: multiple runs", () => {
  test("loads every run folder in ascending run-id order", () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000003", { metadata: metadataFixture({ runId: "RUN-000003" }) });
    writeRunFolder(runsDir, "RUN-000001", { metadata: metadataFixture({ runId: "RUN-000001" }) });
    writeRunFolder(runsDir, "RUN-000002", { metadata: metadataFixture({ runId: "RUN-000002" }) });
    const runs = mod.loadRuns(runsDir);
    assert.deepEqual(runs.map((r) => r.runId), ["RUN-000001", "RUN-000002", "RUN-000003"]);
  });

  test("ignores non-run folders and files mixed into runs/", () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001");
    fs.mkdirSync(path.join(runsDir, "not-a-run"), { recursive: true });
    fs.writeFileSync(path.join(runsDir, "RUN-000099"), "a file, not a directory");
    const runs = mod.loadRuns(runsDir);
    assert.deepEqual(runs.map((r) => r.runId), ["RUN-000001"]);
  });

  test("analyzeSync aggregates correctly across several successful runs with different scores/durations", () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001", { metadata: metadataFixture({ runId: "RUN-000001", durationMs: 1000 }), metrics: metricsFixture({ validationScore: 80, durationMs: 1000 }) });
    writeRunFolder(runsDir, "RUN-000002", { metadata: metadataFixture({ runId: "RUN-000002", durationMs: 300 }), metrics: metricsFixture({ validationScore: 100, durationMs: 300 }) });
    writeRunFolder(runsDir, "RUN-000003", { metadata: metadataFixture({ runId: "RUN-000003", durationMs: 700 }), metrics: metricsFixture({ validationScore: 90, durationMs: 700 }) });
    const { memory } = mod.analyzeSync({ runsDir, outputDir: path.join(path.dirname(runsDir), "memory") });
    assert.equal(memory.runsAnalyzed, 3);
    assert.equal(memory.successfulRuns, 3);
    assert.equal(memory.averageValidationScore, 90); // (80+100+90)/3
    assert.equal(memory.fastestSuccessfulRun.runId, "RUN-000002");
    assert.equal(memory.slowestSuccessfulRun.runId, "RUN-000001");
  });
});

describe("loadRuns: failed runs", () => {
  test("findFailedRuns / findSuccessfulRuns correctly partition a mixed set", () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001", { metadata: metadataFixture({ runId: "RUN-000001", status: "SUCCESS" }) });
    writeRunFolder(runsDir, "RUN-000002", {
      metadata: metadataFixture({ runId: "RUN-000002", status: "FAILED" }),
      metrics: metricsFixture({ validationPassed: false, validationScore: 33 }),
      validation: validationFixture({ status: "rejected", score: 33, approvedForPR: false, rules: [{ id: "RULE-004", description: "Tests passed.", status: "FAIL", details: "1 of 2 failed" }] }),
    });
    const runs = mod.loadRuns(runsDir);
    assert.equal(mod.findSuccessfulRuns(runs).length, 1);
    assert.equal(mod.findFailedRuns(runs).length, 1);
    const { memory } = mod.analyzeSync({ runsDir, outputDir: path.join(path.dirname(runsDir), "memory") });
    assert.equal(memory.successfulRuns, 1);
    assert.equal(memory.failedRuns, 1);
    // A failed run must never be reported as the fastest/slowest "successful" run.
    assert.equal(memory.fastestSuccessfulRun.runId, "RUN-000001");
    assert.equal(memory.slowestSuccessfulRun.runId, "RUN-000001");
  });

  test("a run with no metadata.json at all is counted in runsAnalyzed but classified as neither successful nor failed", () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001", { metadata: null });
    const runs = mod.loadRuns(runsDir);
    assert.equal(runs[0].metadata, null);
    assert.equal(mod.findSuccessfulRuns(runs).length, 0);
    assert.equal(mod.findFailedRuns(runs).length, 0);
    const memory = mod.buildEngineeringMemory(runs);
    assert.equal(memory.runsAnalyzed, 1);
    assert.equal(memory.successfulRuns, 0);
    assert.equal(memory.failedRuns, 0);
  });
});

describe("missing files", () => {
  test("a run missing several files (never written) has null for those fields and is never treated as an error", () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001", { decision: null, execution: null, reflection: null, runSummary: null });
    const runs = mod.loadRuns(runsDir);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].decision, null);
    assert.equal(runs[0].execution, null);
    assert.equal(runs[0].reflection, null);
    assert.equal(runs[0].runSummary, null);
    assert.equal(runs[0].metadata.status, "SUCCESS"); // the files that DO exist are still loaded normally
  });

  test("missing execution.json/decision.json across all runs never crashes aggregation -- just yields empty results", () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001", { execution: null, decision: null });
    writeRunFolder(runsDir, "RUN-000002", { execution: null, decision: null, metadata: metadataFixture({ runId: "RUN-000002" }) });
    const { memory } = mod.analyzeSync({ runsDir, outputDir: path.join(path.dirname(runsDir), "memory") });
    assert.deepEqual(memory.mostModifiedFiles, []);
    assert.deepEqual(memory.mostSuccessfulRecommendations, []);
    assert.equal(memory.runsAnalyzed, 2);
  });
});

describe("corrupted files", () => {
  test("a file that exists but contains invalid JSON is treated exactly like a missing file (null), never throws", () => {
    const runsDir = makeRunsDir();
    const dir = path.join(runsDir, "RUN-000001");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "metadata.json"), "{ this is not valid JSON at all !!");
    fs.writeFileSync(path.join(dir, "validation.json"), JSON.stringify(validationFixture()));
    const runs = mod.loadRuns(runsDir);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].metadata, null);
    assert.equal(runs[0].validation.score, 95);
  });

  test("corrupted files across many runs never crash analyzeSync/buildEngineeringMemory", () => {
    const runsDir = makeRunsDir();
    for (const runId of ["RUN-000001", "RUN-000002", "RUN-000003"]) {
      const dir = path.join(runsDir, runId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "metadata.json"), "not json {{{");
      fs.writeFileSync(path.join(dir, "metrics.json"), "also not json [[[");
      fs.writeFileSync(path.join(dir, "execution.json"), "{{{{");
    }
    const { memory } = mod.analyzeSync({ runsDir, outputDir: path.join(path.dirname(runsDir), "memory") });
    assert.equal(memory.runsAnalyzed, 3);
    assert.equal(memory.successfulRuns, 0);
    assert.equal(memory.failedRuns, 0);
    assert.equal(memory.averageValidationScore, null);
  });
});

describe("averages", () => {
  test("calculateAverageValidationScore averages only runs with a numeric score, rounded to 1 decimal", () => {
    const runs = [{ metrics: { validationScore: 90 } }, { metrics: { validationScore: 91 } }, { metrics: { validationScore: 93 } }, { metrics: {} }, { metrics: null }];
    assert.equal(mod.calculateAverageValidationScore(runs), 91.3); // (90+91+93)/3 = 91.333...
  });

  test("calculateAverageValidationScore returns null when no run has a score", () => {
    assert.equal(mod.calculateAverageValidationScore([{ metrics: {} }, { metrics: null }]), null);
  });

  test("calculateAverageIterations averages only runs with a numeric iteration count, rounded to 1 decimal", () => {
    const runs = [{ metrics: { iterations: 1 } }, { metrics: { iterations: 2 } }, { metrics: { iterations: 1 } }];
    assert.equal(mod.calculateAverageIterations(runs), 1.3); // (1+2+1)/3 = 1.333...
  });

  test("calculateAverageIterations returns null when no run has an iteration count", () => {
    assert.equal(mod.calculateAverageIterations([{ metrics: {} }]), null);
  });
});

describe("recommendations", () => {
  test("findMostSuccessfulRecommendationPatterns tallies success/total counts and sorts by success count", () => {
    const runs = [
      { decision: { selectedTitle: "Extract Auth" }, metadata: { status: "SUCCESS" } },
      { decision: { selectedTitle: "Extract Auth" }, metadata: { status: "SUCCESS" } },
      { decision: { selectedTitle: "Extract Auth" }, metadata: { status: "FAILED" } },
      { decision: { selectedTitle: "Reduce coupling" }, metadata: { status: "SUCCESS" } },
      { decision: { selectedTitle: "Never succeeded" }, metadata: { status: "FAILED" } },
    ];
    const result = mod.findMostSuccessfulRecommendationPatterns(runs);
    assert.deepEqual(result, [
      { title: "Extract Auth", successCount: 2, totalCount: 3 },
      { title: "Reduce coupling", successCount: 1, totalCount: 1 },
    ]);
  });

  test("excludes recommendations with zero successes -- never a fabricated \"most successful\" entry", () => {
    const runs = [{ decision: { selectedTitle: "Always fails" }, metadata: { status: "FAILED" } }];
    assert.deepEqual(mod.findMostSuccessfulRecommendationPatterns(runs), []);
  });

  test("respects the limit parameter and breaks ties alphabetically", () => {
    const runs = ["B", "A", "C"].map((title) => ({ decision: { selectedTitle: title }, metadata: { status: "SUCCESS" } }));
    const result = mod.findMostSuccessfulRecommendationPatterns(runs, 2);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((r) => r.title), ["A", "B"]);
  });

  test("runs with no decision.json (missing or corrupted) are simply skipped, never crash", () => {
    const runs = [{ decision: null, metadata: { status: "SUCCESS" } }, { decision: {}, metadata: { status: "SUCCESS" } }];
    assert.deepEqual(mod.findMostSuccessfulRecommendationPatterns(runs), []);
  });
});

describe("failure statistics", () => {
  test("findMostCommonFailureReasons tallies FAILed rule descriptions across runs, most common first", () => {
    const runs = [
      { validation: { rules: [{ id: "RULE-004", description: "Tests passed.", status: "FAIL" }] } },
      { validation: { rules: [{ id: "RULE-004", description: "Tests passed.", status: "FAIL" }] } },
      { validation: { rules: [{ id: "RULE-002", description: "Only approved files modified.", status: "FAIL" }] } },
      { validation: { rules: [{ id: "RULE-001", description: "Execution completed successfully.", status: "PASS" }] } },
    ];
    const result = mod.findMostCommonFailureReasons(runs);
    assert.deepEqual(result, [
      { reason: "Tests passed.", count: 2 },
      { reason: "Only approved files modified.", count: 1 },
    ]);
  });

  test("ignores runs with no validation.json (missing or corrupted), never crashes", () => {
    const runs = [{ validation: null }, { validation: {} }, { validation: { rules: null } }];
    assert.deepEqual(mod.findMostCommonFailureReasons(runs), []);
  });

  test("respects the limit parameter", () => {
    const runs = ["A", "B", "C", "D"].map((id) => ({ validation: { rules: [{ id, description: `Reason ${id}`, status: "FAIL" }] } }));
    assert.equal(mod.findMostCommonFailureReasons(runs, 2).length, 2);
  });
});

describe("mostModifiedFiles", () => {
  test("tallies files across every run's execution.modifiedFiles, most-modified first", () => {
    const runs = [
      { execution: { modifiedFiles: ["a.js", "b.js"] } },
      { execution: { modifiedFiles: ["a.js"] } },
      { execution: { modifiedFiles: ["c.js"] } },
      { execution: null },
    ];
    assert.deepEqual(mod.findMostModifiedFiles(runs), [
      { file: "a.js", count: 2 },
      { file: "b.js", count: 1 },
      { file: "c.js", count: 1 },
    ]);
  });

  test("respects the limit parameter", () => {
    const runs = [{ execution: { modifiedFiles: ["a.js", "b.js", "c.js"] } }];
    assert.equal(mod.findMostModifiedFiles(runs, 2).length, 2);
  });
});

describe("fastest/slowest successful run", () => {
  test("returns null for both when there are no successful runs with a duration", () => {
    assert.equal(mod.findFastestSuccessfulRun([]), null);
    assert.equal(mod.findSlowestSuccessfulRun([]), null);
    assert.equal(mod.findFastestSuccessfulRun([{ metrics: {} }]), null);
  });

  test("summarizes runId/durationMs/goal/provider from the real fixture data", () => {
    const runs = [{ runId: "RUN-000001", metrics: { durationMs: 500 }, metadata: { goal: "fix bug", provider: "stub-deterministic-v1" } }];
    assert.deepEqual(mod.findFastestSuccessfulRun(runs), { runId: "RUN-000001", durationMs: 500, goal: "fix bug", provider: "stub-deterministic-v1" });
  });
});

describe("report.md generation", () => {
  test("includes every required section", () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001");
    const { memory, mdPath } = mod.analyzeSync({ runsDir, outputDir: path.join(path.dirname(runsDir), "memory") });
    const markdown = fs.readFileSync(mdPath, "utf8");
    for (const heading of [
      "# Engineering Memory Report",
      "## Overview",
      "## Most Modified Files",
      "## Most Successful Recommendations",
      "## Most Common Failure Reasons",
      "## Fastest Successful Run",
      "## Slowest Successful Run",
    ]) {
      assert.match(markdown, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `expected report.md to include "${heading}"`);
    }
    assert.match(markdown, /RUN-000001/);
    assert.equal(mod.renderReportMarkdown(memory).length > 0, true);
  });

  test("renders honest \"None\"/\"N/A\" placeholders for an empty history, never fabricated data", () => {
    const memory = mod.buildEngineeringMemory([]);
    const markdown = mod.renderReportMarkdown(memory);
    assert.match(markdown, /Average validation score: N\/A/);
    assert.match(markdown, /Runs analyzed: 0/);
  });
});

describe("async API (fs/promises)", () => {
  test("loadRunsAsync produces the same result as loadRuns for the same fixture", async () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001");
    writeRunFolder(runsDir, "RUN-000002", { metadata: metadataFixture({ runId: "RUN-000002", status: "FAILED" }) });
    const syncRuns = mod.loadRuns(runsDir);
    const asyncRuns = await mod.loadRunsAsync(runsDir);
    assert.deepEqual(asyncRuns, syncRuns);
  });

  test("analyze() (async) writes the same output as analyzeSync()", async () => {
    const runsDir = makeRunsDir();
    writeRunFolder(runsDir, "RUN-000001");
    const outputDir = path.join(path.dirname(runsDir), "memory");
    const { memory, jsonPath, mdPath } = await mod.analyze({ runsDir, outputDir });
    assert.equal(memory.runsAnalyzed, 1);
    assert.equal(fs.existsSync(jsonPath), true);
    assert.equal(fs.existsSync(mdPath), true);
  });

  test("loadRunsAsync on an empty/missing directory returns an empty array, and corrupted files still resolve to null", async () => {
    const runsDir = makeRunsDir();
    assert.deepEqual(await mod.loadRunsAsync(runsDir), []);
    const dir = path.join(runsDir, "RUN-000001");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "metadata.json"), "not valid json");
    const runs = await mod.loadRunsAsync(runsDir);
    assert.equal(runs[0].metadata, null);
  });
});

describe("standalone CLI", () => {
  test("main() analyzes an isolated directory when called directly (against the real module)", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "engineering-memory-main-"));
    const runsDir = path.join(fixtureRoot, "runs");
    writeRunFolder(runsDir, "RUN-000001");
    const outputDir = path.join(fixtureRoot, "memory");
    const result = await mod.main({ runsDir, outputDir });
    assert.equal(result.memory.runsAnalyzed, 1);
    assert.equal(fs.existsSync(path.join(outputDir, "engineering-memory.json")), true);
  });

  test("main() analyzes the module's own configured runs directory (via RUN_HISTORY_DIR)", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "engineering-memory-cli-"));
    fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "scripts/engineering-memory.js"), source);
    writeRunFolder(path.join(fixtureRoot, "runs"), "RUN-000001");

    const result = spawnSync("node", ["scripts/engineering-memory.js"], { cwd: fixtureRoot, encoding: "utf8" });
    assert.equal(result.status, 0, `expected the CLI to succeed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Analyzed 1 run/);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "memory", "engineering-memory.json")), true);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "memory", "report.md")), true);
  });

  test("the CLI succeeds even with a completely empty runs/ directory", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "engineering-memory-cli-empty-"));
    fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "scripts/engineering-memory.js"), source);
    const result = spawnSync("node", ["scripts/engineering-memory.js"], { cwd: fixtureRoot, encoding: "utf8" });
    assert.equal(result.status, 0, `expected the CLI to succeed with no runs/ directory at all:\n${result.stdout}\n${result.stderr}`);
    const memory = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "memory", "engineering-memory.json"), "utf8"));
    assert.equal(memory.runsAnalyzed, 0);
  });
});

describe("orchestrator integration (simulated real orchestrator-shaped call)", () => {
  test("accepts the exact {runsDir, outputDir} shape the orchestrator's runMemoryStage() would call it with", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "engineering-memory-orch-"));
    const runsDir = path.join(fixtureRoot, "runs");
    writeRunFolder(runsDir, "RUN-000001");
    writeRunFolder(runsDir, "RUN-000002", { metadata: metadataFixture({ runId: "RUN-000002", status: "FAILED" }) });
    const outputDir = path.join(fixtureRoot, "memory");
    const result = mod.analyzeSync({ runsDir, outputDir });
    assert.equal(result.memory.runsAnalyzed, 2);
    assert.equal(path.dirname(result.jsonPath), outputDir);
    assert.equal(fs.existsSync(result.jsonPath), true);
  });

  test("analyzeSync never throws for a runs/ directory that does not exist yet (a fresh repository)", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "engineering-memory-orch-fresh-"));
    const result = mod.analyzeSync({ runsDir: path.join(fixtureRoot, "runs"), outputDir: path.join(fixtureRoot, "memory") });
    assert.equal(result.memory.runsAnalyzed, 0);
  });
});

console.log("All Engineering Memory Engine v1 regression scenarios passed (run under node:test).");
