#!/usr/bin/env node
// Execution Planner v1 regression coverage.
//
// Uses Node's built-in `node:test` + `node:assert/strict` (zero new dependencies), the same deliberate
// deviation used by every recent engine's own test suite in this repo (no Jest anywhere; see
// engineering-memory.test.js's header for the full rationale).
//
// Isolation: the real scripts/execution-planner.js is required ONCE (not a fresh temp-copied module per
// test) -- plan() and every loader accept explicit paths, so per-test isolation comes from pointing those at
// fresh mkdtemp'd fixture files, keeping V8's coverage instrumentation attributing everything to one real
// file path.
//
// Run with:                         node scripts/execution-planner.test.js
// Run with coverage:  node --test --experimental-test-coverage scripts/execution-planner.test.js
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "scripts/execution-planner.js"), "utf8");
const mod = require(path.join(repoRoot, "scripts/execution-planner.js"));

function makeFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "execution-planner-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function decisionFixture(overrides) {
  return {
    generatedFrom: "recommendations/recommendations.json",
    historicalContextSource: "historical-context/historical-context.json",
    engineeringMemorySource: "memory/engineering-memory.json",
    sourceProjectName: "G-VAMS-ERP",
    sourceTimestamp: "2026-01-01T00:00:00.000Z",
    scoringWeights: { recommendationQuality: 0.4, historicalSuccess: 0.3, validationScore: 0.15, frequency: 0.1, confidence: 0.05 },
    scoringFormula: "...",
    historicalContextAvailable: true,
    candidatesEvaluated: 1,
    timestamp: "2026-01-01T00:00:01.000Z",
    selectedRecommendationId: 1,
    selectedRecommendation: "Extract Authentication logic into smaller units",
    selectionReason: { recommendationScore: 90, historicalSuccessRate: 80, historicalEvidence: 3, confidence: 0.85 },
    estimatedImpact: "High",
    estimatedRisk: "Low",
    estimatedImplementationSize: "Small",
    finalScore: 85,
    alternatives: [],
    ...overrides,
  };
}

function recommendationFixture(overrides) {
  return {
    id: 1,
    ruleKey: "extract-complex-logic",
    title: "Extract Authentication logic into smaller units",
    description: "Authentication has grown complex; extract focused units.",
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

function recommendationsDocFixture(recommendations) {
  return {
    generatedFrom: "engineering-knowledge/engineering-knowledge.json",
    sourceProjectName: "G-VAMS-ERP",
    sourceTimestamp: "2026-01-01T00:00:00.000Z",
    scoringFormula: "...",
    recommendations,
    timestamp: "2026-01-01T00:00:01.000Z",
  };
}

function moduleKnowledgeFixture(overrides) {
  return {
    name: "Authentication",
    detected: true,
    detectionConfidence: "strong",
    businessPurpose: "Handles login/session concerns.",
    layer: "backend",
    relatedFiles: ["backend/controllers/authController.js", "backend/middleware/authMiddleware.js"],
    relatedDependencies: ["bcrypt", "jsonwebtoken"],
    coupledModules: ["Attendance"],
    businessCriticality: "High",
    architecturalImportance: "High",
    estimatedComplexity: "High",
    estimatedMaintenanceRisk: "Medium",
    ...overrides,
  };
}

function engineeringKnowledgeFixture(modules) {
  return {
    generatedFrom: "repository-intelligence/repository-analysis.json",
    sourceProjectName: "G-VAMS-ERP",
    sourceTimestamp: "2026-01-01T00:00:00.000Z",
    modules,
    timestamp: "2026-01-01T00:00:01.000Z",
  };
}

function repositoryAnalysisFixture() {
  return { projectName: "G-VAMS-ERP", languages: [{ language: "JavaScript", fileCount: 1 }], timestamp: "2026-01-01T00:00:00.000Z" };
}

describe("loadDecision", () => {
  test("fails closed with an actionable error when adaptive-decision.json is missing", () => {
    const file = path.join(makeFixtureRoot(), "nope.json");
    assert.throws(() => mod.loadDecision(file), /adaptive-decision\.json not found/);
  });

  test("fails closed with an actionable error when adaptive-decision.json is corrupted", () => {
    const file = path.join(makeFixtureRoot(), "bad.json");
    fs.writeFileSync(file, "{ not valid json !!");
    assert.throws(() => mod.loadDecision(file), /not valid JSON/);
  });

  test("loads and parses a valid adaptive-decision.json", () => {
    const file = path.join(makeFixtureRoot(), "adaptive-decision.json");
    writeJson(file, decisionFixture());
    assert.equal(mod.loadDecision(file).sourceProjectName, "G-VAMS-ERP");
  });
});

describe("loadRecommendations / loadRepositoryAnalysis / loadEngineeringKnowledge: missing files", () => {
  test("all three yield null for a missing file, never throw", () => {
    const fixtureRoot = makeFixtureRoot();
    const missing = path.join(fixtureRoot, "nope.json");
    assert.equal(mod.loadRecommendations(missing), null);
    assert.equal(mod.loadRepositoryAnalysis(missing), null);
    assert.equal(mod.loadEngineeringKnowledge(missing), null);
  });
});

describe("loadRecommendations / loadRepositoryAnalysis / loadEngineeringKnowledge: corrupted files", () => {
  test("all three yield null for a corrupted file, never throw", () => {
    const fixtureRoot = makeFixtureRoot();
    const file = path.join(fixtureRoot, "bad.json");
    fs.writeFileSync(file, "{ not valid json !!");
    assert.equal(mod.loadRecommendations(file), null);
    assert.equal(mod.loadRepositoryAnalysis(file), null);
    assert.equal(mod.loadEngineeringKnowledge(file), null);
  });

  test("valid files load and parse correctly", () => {
    const fixtureRoot = makeFixtureRoot();
    const recFile = path.join(fixtureRoot, "recommendations.json");
    writeJson(recFile, recommendationsDocFixture([recommendationFixture()]));
    assert.equal(mod.loadRecommendations(recFile).recommendations.length, 1);

    const analysisFile = path.join(fixtureRoot, "repository-analysis.json");
    writeJson(analysisFile, repositoryAnalysisFixture());
    assert.equal(mod.loadRepositoryAnalysis(analysisFile).projectName, "G-VAMS-ERP");

    const knowledgeFile = path.join(fixtureRoot, "engineering-knowledge.json");
    writeJson(knowledgeFile, engineeringKnowledgeFixture([moduleKnowledgeFixture()]));
    assert.equal(mod.loadEngineeringKnowledge(knowledgeFile).modules.length, 1);
  });
});

describe("findRecommendation / findModuleKnowledge", () => {
  test("finds by id / name; returns null when not present", () => {
    const doc = recommendationsDocFixture([recommendationFixture({ id: 1 }), recommendationFixture({ id: 2, title: "Other" })]);
    assert.equal(mod.findRecommendation(doc, 2).title, "Other");
    assert.equal(mod.findRecommendation(doc, 99), null);
    assert.equal(mod.findRecommendation(null, 1), null);

    const knowledge = engineeringKnowledgeFixture([moduleKnowledgeFixture({ name: "Authentication" }), moduleKnowledgeFixture({ name: "Reports" })]);
    assert.equal(mod.findModuleKnowledge(knowledge, "Reports").name, "Reports");
    assert.equal(mod.findModuleKnowledge(knowledge, "Nope"), null);
    assert.equal(mod.findModuleKnowledge(null, "Authentication"), null);
  });
});

describe("resolveRecommendation", () => {
  test("returns the real recommendations.json entry when found", () => {
    const decision = decisionFixture();
    const doc = recommendationsDocFixture([recommendationFixture()]);
    const resolved = mod.resolveRecommendation(decision, doc);
    assert.equal(resolved.ruleKey, "extract-complex-logic");
    assert.deepEqual(resolved.affectedFiles, ["backend/controllers/authController.js"]);
  });

  test("synthesizes a fallback from decision.json's own fields when recommendationsDoc is null", () => {
    const decision = decisionFixture();
    const resolved = mod.resolveRecommendation(decision, null);
    assert.equal(resolved.id, 1);
    assert.equal(resolved.title, "Extract Authentication logic into smaller units");
    assert.equal(resolved.ruleKey, null);
    assert.deepEqual(resolved.affectedFiles, []);
    assert.deepEqual(resolved.affectedModules, []);
    assert.equal(resolved.estimatedImplementationSize, "Small");
    assert.equal(resolved.estimatedRisk, "Low");
    assert.equal(resolved.estimatedImpact, "High");
  });

  test("synthesizes a fallback when the id can no longer be found in recommendations.json (stale state)", () => {
    const decision = decisionFixture({ selectedRecommendationId: 99, selectedRecommendation: "Vanished" });
    const doc = recommendationsDocFixture([recommendationFixture({ id: 1 })]);
    const resolved = mod.resolveRecommendation(decision, doc);
    assert.equal(resolved.id, 99);
    assert.equal(resolved.title, "Vanished");
  });
});

describe("identifyAffectedFiles", () => {
  test("uses the recommendation's own affectedFiles when present (deduplicated and sorted)", () => {
    const rec = recommendationFixture({ affectedFiles: ["b.js", "a.js", "a.js"] });
    assert.deepEqual(mod.identifyAffectedFiles(rec, null), ["a.js", "b.js"]);
  });

  test("falls back to engineering-knowledge.json's relatedFiles for the affected module(s) when the recommendation lists none", () => {
    const rec = recommendationFixture({ affectedFiles: [], affectedModules: ["Authentication"] });
    const knowledge = engineeringKnowledgeFixture([moduleKnowledgeFixture()]);
    assert.deepEqual(mod.identifyAffectedFiles(rec, knowledge), ["backend/controllers/authController.js", "backend/middleware/authMiddleware.js"]);
  });

  test("returns an empty array when neither source has data, never a crash", () => {
    const rec = recommendationFixture({ affectedFiles: [], affectedModules: [] });
    assert.deepEqual(mod.identifyAffectedFiles(rec, null), []);
  });
});

describe("identifyAffectedModules", () => {
  test("directly reflects the recommendation's own affectedModules", () => {
    assert.deepEqual(mod.identifyAffectedModules(recommendationFixture({ affectedModules: ["Authentication", "Attendance"] })), ["Authentication", "Attendance"]);
    assert.deepEqual(mod.identifyAffectedModules({}), []);
  });
});

describe("buildImplementationSteps: extract recommendation", () => {
  test("the extract-complex-logic template matches this task's own worked example chain", () => {
    const rec = recommendationFixture({ ruleKey: "extract-complex-logic" });
    const steps = mod.buildImplementationSteps(rec, ["a.js"], ["Authentication"]);
    assert.equal(steps.length, 6);
    assert.deepEqual(steps.map((s) => s.order), [1, 2, 3, 4, 5, 6]);
    assert.match(steps[0].description, /Analyze/);
    assert.match(steps[1].description, /Create a new, focused service\/module.*Authentication/);
    assert.match(steps[2].description, /Move the identified logic/);
    assert.match(steps[3].description, /Update imports/);
    assert.match(steps[4].description, /Remove the now-redundant/);
    assert.match(steps[5].description, /Run the validation checklist/);
  });
});

describe("buildImplementationSteps: coupling recommendation", () => {
  test("the reduce-coupling template substitutes the primary affected module name", () => {
    const rec = recommendationFixture({ ruleKey: "reduce-coupling" });
    const steps = mod.buildImplementationSteps(rec, ["shared.js"], ["Authentication", "Attendance"]);
    assert.equal(steps.length, 5);
    assert.match(steps[0].description, /Authentication and its coupled module/);
    assert.match(steps[3].description, /Update Authentication and its coupled module/);
  });
});

describe("buildImplementationSteps: other rule keys and fallback", () => {
  test("address-maintenance-risk and strengthen-detection-coverage each have their own deterministic template", () => {
    const riskSteps = mod.buildImplementationSteps(recommendationFixture({ ruleKey: "address-maintenance-risk" }), [], ["Authentication"]);
    assert.equal(riskSteps.length, 4);
    const coverageSteps = mod.buildImplementationSteps(recommendationFixture({ ruleKey: "strengthen-detection-coverage" }), [], ["Authentication"]);
    assert.equal(coverageSteps.length, 3);
  });

  test("an unrecognized or null ruleKey falls back to the fixed default template", () => {
    const unknown = mod.buildImplementationSteps(recommendationFixture({ ruleKey: "some-future-rule" }), [], []);
    const nullKey = mod.buildImplementationSteps(recommendationFixture({ ruleKey: null }), [], []);
    assert.deepEqual(unknown.map((s) => s.description), mod.DEFAULT_STEP_TEMPLATE);
    assert.deepEqual(nullKey.map((s) => s.description), mod.DEFAULT_STEP_TEMPLATE);
  });

  test("uses a generic module placeholder when no affected module is known", () => {
    const steps = mod.buildImplementationSteps(recommendationFixture({ ruleKey: "extract-complex-logic" }), [], []);
    assert.match(steps[1].description, /the affected code/);
  });
});

describe("buildValidationChecklist", () => {
  test("always includes the fixed baseline plus one entry per cited reason", () => {
    const checklist = mod.buildValidationChecklist(recommendationFixture({ reason: ["Reason A", "Reason B"] }));
    assert.equal(checklist.length, 5);
    assert.ok(checklist.some((c) => c.includes("Reason A")));
    assert.ok(checklist.some((c) => c.includes("Reason B")));
  });

  test("no cited reasons yields exactly the fixed baseline, never fabricated", () => {
    assert.equal(mod.buildValidationChecklist(recommendationFixture({ reason: [] })).length, 3);
    assert.equal(mod.buildValidationChecklist({}).length, 3);
  });
});

describe("buildRollbackTargets", () => {
  test("one rollback target per affected file", () => {
    const targets = mod.buildRollbackTargets(["a.js", "b.js"]);
    assert.equal(targets.length, 2);
    assert.equal(targets[0].file, "a.js");
    assert.match(targets[0].method, /git checkout -- a\.js/);
  });

  test("an honest single entry when there are no affected files, never fabricated", () => {
    const targets = mod.buildRollbackTargets([]);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].file, null);
    assert.match(targets[0].method, /No affected files/);
  });
});

describe("identifyDependencies", () => {
  test("returns the primary affected module's own coupledModules", () => {
    const knowledge = engineeringKnowledgeFixture([moduleKnowledgeFixture({ name: "Authentication", coupledModules: ["Attendance", "Reports"] })]);
    assert.deepEqual(mod.identifyDependencies(["Authentication"], knowledge), ["Attendance", "Reports"]);
  });

  test("returns an empty array when there is no primary module or no matching knowledge entry", () => {
    assert.deepEqual(mod.identifyDependencies([], null), []);
    assert.deepEqual(mod.identifyDependencies(["Unknown"], engineeringKnowledgeFixture([moduleKnowledgeFixture()])), []);
  });
});

describe("estimateEffort", () => {
  test("Small/Medium/Large base hours, plus 0.5h per extra file (hand-verified: 3 files -> 3.0h)", () => {
    assert.deepEqual(mod.estimateEffort(recommendationFixture({ estimatedImplementationSize: "Small" }), ["a.js", "b.js", "c.js"]), { size: "Small", estimatedHours: 3, fileCount: 3 });
    assert.equal(mod.estimateEffort(recommendationFixture({ estimatedImplementationSize: "Medium" }), []).estimatedHours, 6);
    assert.equal(mod.estimateEffort(recommendationFixture({ estimatedImplementationSize: "Large" }), []).estimatedHours, 16);
  });

  test("extra-hour contribution is capped (hand-verified: Large + 20 files -> 24h, not 25.5h)", () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}.js`);
    assert.equal(mod.estimateEffort(recommendationFixture({ estimatedImplementationSize: "Large" }), files).estimatedHours, 24);
  });

  test("an unrecognized size falls back to the Medium base, never crashes", () => {
    assert.equal(mod.estimateEffort(recommendationFixture({ estimatedImplementationSize: "Unknown" }), []).estimatedHours, 6);
  });
});

describe("estimateRisk: risk", () => {
  test("no elevating factors leaves the recommendation's own risk level unchanged", () => {
    const rec = recommendationFixture({ estimatedRisk: "Low" });
    const decision = decisionFixture({ selectionReason: { historicalSuccessRate: 100, historicalEvidence: 0, recommendationScore: 90, confidence: 0.9 } });
    const result = mod.estimateRisk(rec, ["a.js"], ["Authentication"], decision);
    assert.equal(result.level, "Low");
    assert.equal(result.factors.length, 2);
  });

  test("2+ affected modules elevates risk by one level (hand-verified: Medium + coupling + low history -> High)", () => {
    const rec = recommendationFixture({ ruleKey: "reduce-coupling", estimatedRisk: "Medium" });
    const decision = decisionFixture({ selectionReason: { historicalSuccessRate: 30, historicalEvidence: 4, recommendationScore: 90, confidence: 0.9 } });
    const result = mod.estimateRisk(rec, ["shared.js"], ["Authentication", "Attendance"], decision);
    assert.equal(result.level, "High");
    assert.equal(result.factors.length, 4);
    assert.ok(result.factors.some((f) => f.includes("cross-module coupling")));
    assert.ok(result.factors.some((f) => f.includes("30% historical success rate")));
  });

  test("risk is capped at High even with multiple elevating factors", () => {
    const rec = recommendationFixture({ estimatedRisk: "High" });
    const decision = decisionFixture({ selectionReason: { historicalSuccessRate: 0, historicalEvidence: 5, recommendationScore: 90, confidence: 0.9 } });
    const result = mod.estimateRisk(rec, ["a.js"], ["A", "B", "C"], decision);
    assert.equal(result.level, "High");
  });

  test("a null decision or missing selectionReason never crashes and applies no historical bump", () => {
    const rec = recommendationFixture({ estimatedRisk: "Low" });
    assert.equal(mod.estimateRisk(rec, [], [], null).level, "Low");
    assert.equal(mod.estimateRisk(rec, [], [], {}).level, "Low");
  });
});

describe("buildCompletionCriteria", () => {
  test("returns the fixed baseline", () => {
    assert.equal(mod.buildCompletionCriteria().length, 4);
  });
});

describe("generateExecutionPlan: no selection", () => {
  test("an honest, entirely empty plan when adaptive-decision.json selected nothing, never fabricated", () => {
    const decision = decisionFixture({ selectedRecommendationId: null, selectedRecommendation: null });
    const sources = { decisionPath: "/fake/d.json", recommendationsPath: "/fake/r.json", repositoryAnalysisPath: "/fake/a.json", engineeringKnowledgePath: "/fake/k.json" };
    const executionPlan = mod.generateExecutionPlan(decision, null, null, null, sources);
    assert.equal(executionPlan.selectedRecommendation, null);
    assert.deepEqual(executionPlan.affectedFiles, []);
    assert.deepEqual(executionPlan.implementationSteps, []);
    assert.deepEqual(executionPlan.estimatedEffort, { size: "Not applicable", estimatedHours: 0, fileCount: 0 });
    assert.deepEqual(executionPlan.estimatedRisk, { level: "Not applicable", factors: [] });
  });
});

describe("generateExecutionPlan: full plan with all inputs available", () => {
  test("produces a fully-populated plan grounded in recommendations.json/engineering-knowledge.json", () => {
    const decision = decisionFixture();
    const recommendationsDoc = recommendationsDocFixture([recommendationFixture()]);
    const engineeringKnowledge = engineeringKnowledgeFixture([moduleKnowledgeFixture()]);
    const sources = { decisionPath: "/fake/d.json", recommendationsPath: "/fake/r.json", repositoryAnalysisPath: "/fake/a.json", engineeringKnowledgePath: "/fake/k.json" };
    const executionPlan = mod.generateExecutionPlan(decision, recommendationsDoc, repositoryAnalysisFixture(), engineeringKnowledge, sources);
    assert.equal(executionPlan.selectedRecommendation.id, 1);
    assert.equal(executionPlan.goal, "Authentication has grown complex; extract focused units.");
    assert.deepEqual(executionPlan.affectedModules, ["Authentication"]);
    assert.equal(executionPlan.implementationSteps.length, 6);
    assert.equal(executionPlan.dependencies.length, 1);
    assert.equal(executionPlan.inputsAvailable.recommendations, true);
    assert.equal(executionPlan.inputsAvailable.engineeringKnowledge, true);
    assert.equal(executionPlan.inputsAvailable.repositoryAnalysis, true);
  });
});

describe("generateExecutionPlan: missing optional inputs (best available plan)", () => {
  test("with recommendations.json/repository-analysis.json/engineering-knowledge.json all unavailable, still produces a plan from decision.json alone", () => {
    const decision = decisionFixture();
    const sources = { decisionPath: "/fake/d.json", recommendationsPath: "/fake/r.json", repositoryAnalysisPath: "/fake/a.json", engineeringKnowledgePath: "/fake/k.json" };
    const executionPlan = mod.generateExecutionPlan(decision, null, null, null, sources);
    assert.equal(executionPlan.selectedRecommendation.title, "Extract Authentication logic into smaller units");
    assert.deepEqual(executionPlan.affectedFiles, []);
    assert.deepEqual(executionPlan.affectedModules, []);
    assert.equal(executionPlan.implementationSteps.length, 3); // DEFAULT_STEP_TEMPLATE, since ruleKey is unknown
    assert.equal(executionPlan.inputsAvailable.recommendations, false);
    assert.equal(executionPlan.inputsAvailable.repositoryAnalysis, false);
    assert.equal(executionPlan.inputsAvailable.engineeringKnowledge, false);
  });
});

describe("generateExecutionPlan: rollback", () => {
  test("rollbackTargets are present and grounded in the plan's own affectedFiles", () => {
    const decision = decisionFixture();
    const recommendationsDoc = recommendationsDocFixture([recommendationFixture({ affectedFiles: ["x.js", "y.js"] })]);
    const sources = { decisionPath: "/fake/d.json", recommendationsPath: "/fake/r.json", repositoryAnalysisPath: "/fake/a.json", engineeringKnowledgePath: "/fake/k.json" };
    const executionPlan = mod.generateExecutionPlan(decision, recommendationsDoc, null, null, sources);
    assert.equal(executionPlan.rollbackTargets.length, 2);
    assert.deepEqual(executionPlan.rollbackTargets.map((t) => t.file), ["x.js", "y.js"]);
  });
});

describe("generateExecutionPlan: validation", () => {
  test("validationChecklist reflects the resolved recommendation's own cited reasons", () => {
    const decision = decisionFixture();
    const recommendationsDoc = recommendationsDocFixture([recommendationFixture({ reason: ["Custom reason one"] })]);
    const sources = { decisionPath: "/fake/d.json", recommendationsPath: "/fake/r.json", repositoryAnalysisPath: "/fake/a.json", engineeringKnowledgePath: "/fake/k.json" };
    const executionPlan = mod.generateExecutionPlan(decision, recommendationsDoc, null, null, sources);
    assert.ok(executionPlan.validationChecklist.some((c) => c.includes("Custom reason one")));
  });
});

describe("renderExecutionPlanMarkdown", () => {
  test("includes every required section for a populated plan", () => {
    const decision = decisionFixture();
    const recommendationsDoc = recommendationsDocFixture([recommendationFixture()]);
    const engineeringKnowledge = engineeringKnowledgeFixture([moduleKnowledgeFixture()]);
    const sources = { decisionPath: "/fake/d.json", recommendationsPath: "/fake/r.json", repositoryAnalysisPath: "/fake/a.json", engineeringKnowledgePath: "/fake/k.json" };
    const executionPlan = mod.generateExecutionPlan(decision, recommendationsDoc, repositoryAnalysisFixture(), engineeringKnowledge, sources);
    const markdown = mod.renderExecutionPlanMarkdown(executionPlan);
    for (const heading of [
      "# Execution Plan Report",
      "## Goal",
      "## Selected Recommendation",
      "## Affected Modules",
      "## Affected Files",
      "## Ordered Implementation Steps",
      "## Validation Checklist",
      "## Estimated Effort",
      "## Estimated Risk",
      "## Rollback Targets",
      "## Dependencies",
      "## Completion Criteria",
      "## Next Step",
    ]) {
      assert.ok(markdown.includes(heading), `expected report to include "${heading}"`);
    }
  });

  test("renders an honest empty-selection report", () => {
    const decision = decisionFixture({ selectedRecommendationId: null, selectedRecommendation: null });
    const sources = { decisionPath: "/fake/d.json", recommendationsPath: "/fake/r.json", repositoryAnalysisPath: "/fake/a.json", engineeringKnowledgePath: "/fake/k.json" };
    const executionPlan = mod.generateExecutionPlan(decision, null, null, null, sources);
    const markdown = mod.renderExecutionPlanMarkdown(executionPlan);
    assert.match(markdown, /None\. adaptive-decision\.json contained no selection/);
  });
});

describe("plan(): full pipeline + output files", () => {
  test("writes both output files with mutually consistent content", () => {
    const fixtureRoot = makeFixtureRoot();
    const decisionPath = path.join(fixtureRoot, "adaptive-decision.json");
    writeJson(decisionPath, decisionFixture());
    const recommendationsPath = path.join(fixtureRoot, "recommendations.json");
    writeJson(recommendationsPath, recommendationsDocFixture([recommendationFixture()]));
    const repositoryAnalysisPath = path.join(fixtureRoot, "repository-analysis.json");
    writeJson(repositoryAnalysisPath, repositoryAnalysisFixture());
    const engineeringKnowledgePath = path.join(fixtureRoot, "engineering-knowledge.json");
    writeJson(engineeringKnowledgePath, engineeringKnowledgeFixture([moduleKnowledgeFixture()]));
    const outputDir = path.join(fixtureRoot, "execution-plan");

    const result = mod.plan({ decisionPath, recommendationsPath, repositoryAnalysisPath, engineeringKnowledgePath, outputDir });
    assert.equal(fs.existsSync(result.jsonPath), true);
    assert.equal(fs.existsSync(result.mdPath), true);
    const written = JSON.parse(fs.readFileSync(result.jsonPath, "utf8"));
    assert.deepEqual(written, result.plan);
    assert.equal(written.selectedRecommendation.id, 1);
  });
});

describe("missing files (whole-pipeline)", () => {
  test("plan() throws only when adaptive-decision.json itself is missing", () => {
    const fixtureRoot = makeFixtureRoot();
    assert.throws(
      () => mod.plan({ decisionPath: path.join(fixtureRoot, "nope.json"), outputDir: path.join(fixtureRoot, "execution-plan") }),
      /adaptive-decision\.json not found/
    );
  });

  test("plan() never throws when recommendations.json/repository-analysis.json/engineering-knowledge.json are all missing", () => {
    const fixtureRoot = makeFixtureRoot();
    const decisionPath = path.join(fixtureRoot, "adaptive-decision.json");
    writeJson(decisionPath, decisionFixture());
    const result = mod.plan({
      decisionPath,
      recommendationsPath: path.join(fixtureRoot, "nope-r.json"),
      repositoryAnalysisPath: path.join(fixtureRoot, "nope-a.json"),
      engineeringKnowledgePath: path.join(fixtureRoot, "nope-k.json"),
      outputDir: path.join(fixtureRoot, "execution-plan"),
    });
    assert.equal(result.plan.selectedRecommendation.title, "Extract Authentication logic into smaller units");
  });
});

describe("corrupted files (whole-pipeline)", () => {
  test("plan() never throws when the optional inputs are corrupted", () => {
    const fixtureRoot = makeFixtureRoot();
    const decisionPath = path.join(fixtureRoot, "adaptive-decision.json");
    writeJson(decisionPath, decisionFixture());
    const recommendationsPath = path.join(fixtureRoot, "recommendations.json");
    fs.writeFileSync(recommendationsPath, "{ corrupted !!");
    const result = mod.plan({ decisionPath, recommendationsPath, outputDir: path.join(fixtureRoot, "execution-plan") });
    assert.equal(result.plan.inputsAvailable.recommendations, false);
  });

  test("plan() throws when adaptive-decision.json itself is corrupted", () => {
    const fixtureRoot = makeFixtureRoot();
    const decisionPath = path.join(fixtureRoot, "adaptive-decision.json");
    fs.writeFileSync(decisionPath, "{ not valid json");
    assert.throws(() => mod.plan({ decisionPath, outputDir: path.join(fixtureRoot, "execution-plan") }), /not valid JSON/);
  });
});

describe("standalone CLI", () => {
  test("main() plans against an isolated set of paths when called directly (against the real module)", () => {
    const fixtureRoot = makeFixtureRoot();
    const decisionPath = path.join(fixtureRoot, "adaptive-decision.json");
    writeJson(decisionPath, decisionFixture());
    const outputDir = path.join(fixtureRoot, "execution-plan");
    const result = mod.main({ decisionPath, outputDir });
    assert.equal(result.plan.selectedRecommendation.id, 1);
    assert.equal(fs.existsSync(path.join(outputDir, "execution-plan.json")), true);
  });

  test("main() plans via the module's own configured default paths (real CLI subprocess)", () => {
    const fixtureRoot = makeFixtureRoot();
    fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "scripts/execution-planner.js"), source);
    writeJson(path.join(fixtureRoot, "decision", "adaptive-decision.json"), decisionFixture());
    writeJson(path.join(fixtureRoot, "recommendations", "recommendations.json"), recommendationsDocFixture([recommendationFixture()]));

    const result = spawnSync("node", ["scripts/execution-planner.js"], { cwd: fixtureRoot, encoding: "utf8" });
    assert.equal(result.status, 0, `expected the CLI to succeed:\n${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "execution-plan", "execution-plan.json")), true);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "execution-plan", "execution-plan.md")), true);
  });

  test("the CLI exits 1 with an actionable error when adaptive-decision.json is missing", () => {
    const fixtureRoot = makeFixtureRoot();
    fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "scripts/execution-planner.js"), source);
    const result = spawnSync("node", ["scripts/execution-planner.js"], { cwd: fixtureRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /adaptive-decision\.json not found/);
  });
});

describe("orchestrator integration (simulated real orchestrator-shaped call)", () => {
  test("accepts the exact {decisionPath, outputDir}-style overrides a spawned CLI stage would run with, without touching downstream Implementation Request Engine's own contract", () => {
    const fixtureRoot = makeFixtureRoot();
    const decisionPath = path.join(fixtureRoot, "adaptive-decision.json");
    writeJson(decisionPath, decisionFixture());
    const outputDir = path.join(fixtureRoot, "execution-plan");
    const result = mod.plan({ decisionPath, outputDir });
    assert.equal(path.dirname(result.jsonPath), outputDir);
    assert.equal(fs.existsSync(result.jsonPath), true);
    // execution-plan.json is a standalone artifact -- it must never overwrite or rename decision.json itself.
    assert.equal(fs.existsSync(decisionPath), true);
    assert.equal(path.basename(result.jsonPath), "execution-plan.json");
  });
});

console.log("All Execution Planner v1 regression scenarios passed (run under node:test).");
