#!/usr/bin/env node
// Execution Planner v1
//
// Converts the selected recommendation (decision/adaptive-decision.json, Adaptive Decision Engine v2's
// output) into an explicit, deterministic engineering execution plan: ordered implementation steps, a
// validation checklist, rollback targets, effort/risk estimates, dependencies, and completion criteria. This
// is NOT an AI component: no embeddings, no vector database, no LLM. Every field traces back to already-
// recorded facts on the selected recommendation/decision/repository analysis/engineering knowledge -- this
// engine never invents a step, a file, or a risk factor that isn't grounded in an upstream artifact.
//
// Run with:   node scripts/execution-planner.js
// Inputs (env vars reused verbatim from the engines that already produce them, per this codebase's own
// convention -- see adaptive-decision-engine.js's header for the precedent):
//   DECISION_OUTPUT_DIR         (Adaptive Decision Engine v2's own output dir; default "decision"; this
//                                engine reads adaptive-decision.json from it -- the ONE required input)
//   RECOMMENDATIONS_PATH        (Recommendation Engine v1's own input-path env var; default
//                                "recommendations/recommendations.json"; optional)
//   REPO_INTEL_OUTPUT_DIR       (Repository Intelligence v1's own output dir; default
//                                "repository-intelligence"; optional)
//   ENGINEERING_KNOWLEDGE_PATH  (Engineering Knowledge Engine v1's/Recommendation Engine v1's own input-path
//                                env var; default "engineering-knowledge/engineering-knowledge.json";
//                                optional)
// Output dir defaults to `execution-plan/` at the repository root; override with EXECUTION_PLAN_OUTPUT_DIR.
//
// FAILURE POLICY: adaptive-decision.json is the ONLY required input -- missing or corrupted, this engine
// fails closed with a clear, actionable error (there is no decision to plan from). recommendations.json,
// repository-analysis.json, and engineering-knowledge.json are all optional: missing or corrupted, each
// degrades gracefully to `null` and this engine still produces the best available plan from whatever data it
// does have (see resolveRecommendation()) -- it never throws because an enrichment input was unavailable.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const decisionDir = path.resolve(root, process.env.DECISION_OUTPUT_DIR || "decision");
const decisionPath = path.join(decisionDir, "adaptive-decision.json");
const recommendationsPath = path.resolve(root, process.env.RECOMMENDATIONS_PATH || "recommendations/recommendations.json");
const repoIntelDir = path.resolve(root, process.env.REPO_INTEL_OUTPUT_DIR || "repository-intelligence");
const repositoryAnalysisPath = path.join(repoIntelDir, "repository-analysis.json");
const engineeringKnowledgePath = path.resolve(root, process.env.ENGINEERING_KNOWLEDGE_PATH || "engineering-knowledge/engineering-knowledge.json");
const outputDir = path.resolve(root, process.env.EXECUTION_PLAN_OUTPUT_DIR || "execution-plan");

const RISK_LEVELS = ["Low", "Medium", "High"];
const EFFORT_BASE_HOURS = { Small: 2, Medium: 6, Large: 16, "Not applicable": 1 };
const EXTRA_HOURS_PER_FILE = 0.5;
const MAX_EXTRA_HOURS = 8;

// Deterministic, ordered step templates keyed by recommendations.json's own `ruleKey` (see
// recommendation-engine.js's RULES) -- the SAME grounded classification recommendations.json already
// assigned, never re-derived or guessed. `{module}` is replaced with the primary affected module's name.
// The "extract-complex-logic" chain matches this task's own worked example (Extract Logic -> Create service
// -> Move logic -> Update imports -> Remove duplication -> Run validation).
const STEP_TEMPLATES = {
  "extract-complex-logic": [
    "Analyze the current implementation in the affected file(s) to identify the logic to extract.",
    "Create a new, focused service/module to hold the extracted logic for {module}.",
    "Move the identified logic out of the largest affected file(s) into the new service.",
    "Update imports/references across the affected file(s) to use the new service.",
    "Remove the now-redundant original logic to eliminate duplication.",
    "Run the validation checklist to confirm no behavior changed.",
  ],
  "reduce-coupling": [
    "Analyze the files shared between {module} and its coupled module(s).",
    "Define clear ownership boundaries for the shared logic.",
    "Extract the shared logic into a dedicated module.",
    "Update {module} and its coupled module(s) to reference the new shared module.",
    "Run the validation checklist to confirm no behavior changed.",
  ],
  "address-maintenance-risk": [
    "Review the affected file(s) for outstanding technical-debt markers and untested paths.",
    "Add or update automated tests covering the previously untested paths.",
    "Resolve the identified technical-debt items without changing observable behavior.",
    "Run the validation checklist to confirm no behavior changed.",
  ],
  "strengthen-detection-coverage": [
    "Give {module} clearer, dedicated file naming so its scope is unambiguous.",
    "Add focused tests that make {module}'s behavior and boundaries explicit.",
    "Run the validation checklist to confirm no behavior changed.",
  ],
};
const DEFAULT_STEP_TEMPLATE = ["Review the affected file(s) and plan the specific change.", "Implement the change in the affected file(s).", "Run the validation checklist to confirm no behavior changed."];

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

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Loads and parses adaptive-decision.json. Fails closed with a clear, actionable error if the file is
 * missing or not valid JSON -- this is the ONE required input; with no decision, there is nothing to plan.
 * @param {string} file absolute path to adaptive-decision.json
 * @returns {object} the parsed decision document
 */
function loadDecision(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`adaptive-decision.json not found at ${path.relative(root, file)}. Run \`node scripts/adaptive-decision-engine.js\` first (or set DECISION_OUTPUT_DIR).`);
  }
  try {
    return readJson(file);
  } catch (error) {
    throw new Error(`adaptive-decision.json at ${path.relative(root, file)} is not valid JSON: ${error.message}`);
  }
}

/**
 * Loads and parses recommendations.json. Missing or corrupted is `null`, never a crash -- an optional
 * enrichment input (see resolveRecommendation()'s fallback when this is unavailable).
 * @param {string} file absolute path to recommendations.json
 * @returns {(object|null)}
 */
function loadRecommendations(file) {
  return readJsonSafe(file);
}

/**
 * Loads and parses repository-analysis.json. Missing or corrupted is `null`, never a crash -- an optional
 * enrichment input (currently informs identifyAffectedFiles()'s module-evidence fallback indirectly via
 * engineering-knowledge.json, which is itself derived from this file).
 * @param {string} file absolute path to repository-analysis.json
 * @returns {(object|null)}
 */
function loadRepositoryAnalysis(file) {
  return readJsonSafe(file);
}

/**
 * Loads and parses engineering-knowledge.json. Missing or corrupted is `null`, never a crash -- an optional
 * enrichment input used to fall back to a module's own relatedFiles/coupledModules when recommendations.json
 * is unavailable or the selected recommendation itself listed no affected files.
 * @param {string} file absolute path to engineering-knowledge.json
 * @returns {(object|null)}
 */
function loadEngineeringKnowledge(file) {
  return readJsonSafe(file);
}

function findRecommendation(recommendationsDoc, id) {
  return ((recommendationsDoc && recommendationsDoc.recommendations) || []).find((recommendation) => recommendation.id === id) || null;
}

function findModuleKnowledge(engineeringKnowledge, name) {
  return ((engineeringKnowledge && engineeringKnowledge.modules) || []).find((module) => module.name === name) || null;
}

/**
 * Resolves the fullest available description of the selected recommendation: the real recommendations.json
 * entry when available, otherwise a synthesized stand-in built ONLY from adaptive-decision.json's own
 * already-recorded fields (title/estimatedImpact/estimatedRisk/estimatedImplementationSize) -- so this
 * engine can always produce a plan, degraded but never fabricated, exactly per this engine's own failure
 * policy ("continue, produce the best available plan").
 * @param {object} decision parsed adaptive-decision.json (already confirmed to have a selection)
 * @param {(object|null)} recommendationsDoc parsed recommendations.json, or null if unavailable
 * @returns {object} a recommendation-shaped object (real or synthesized)
 */
function resolveRecommendation(decision, recommendationsDoc) {
  const real = recommendationsDoc ? findRecommendation(recommendationsDoc, decision.selectedRecommendationId) : null;
  if (real) return real;
  return {
    id: decision.selectedRecommendationId,
    ruleKey: null,
    title: decision.selectedRecommendation,
    description: decision.selectedRecommendation,
    reason: [],
    affectedModules: [],
    affectedFiles: [],
    estimatedImplementationSize: decision.estimatedImplementationSize || "Medium",
    estimatedRisk: decision.estimatedRisk || "Medium",
    estimatedImpact: decision.estimatedImpact || "Medium",
  };
}

/**
 * Identifies the affected files: the selected recommendation's own affectedFiles when present, falling back
 * to engineering-knowledge.json's relatedFiles for the recommendation's affected module(s) when the
 * recommendation itself listed none (e.g. a synthesized fallback recommendation). Deduplicated and sorted
 * for determinism.
 * @param {{affectedFiles: string[], affectedModules: string[]}} recommendation
 * @param {(object|null)} engineeringKnowledge
 * @returns {string[]}
 */
function identifyAffectedFiles(recommendation, engineeringKnowledge) {
  if (recommendation.affectedFiles && recommendation.affectedFiles.length > 0) {
    return [...new Set(recommendation.affectedFiles)].sort();
  }
  const files = new Set();
  for (const moduleName of recommendation.affectedModules || []) {
    const moduleKnowledge = findModuleKnowledge(engineeringKnowledge, moduleName);
    for (const file of (moduleKnowledge && moduleKnowledge.relatedFiles) || []) files.add(file);
  }
  return [...files].sort();
}

/**
 * Identifies the affected modules: a direct, deterministic read of the recommendation's own affectedModules
 * -- never re-derived or guessed.
 * @param {{affectedModules: string[]}} recommendation
 * @returns {string[]}
 */
function identifyAffectedModules(recommendation) {
  return [...(recommendation.affectedModules || [])];
}

/**
 * Builds the ordered implementation steps from a fixed, deterministic template keyed by the recommendation's
 * own ruleKey (see STEP_TEMPLATES); an unrecognized or absent ruleKey (e.g. a synthesized fallback
 * recommendation) uses DEFAULT_STEP_TEMPLATE.
 * @param {{ruleKey: (string|null)}} recommendation
 * @param {string[]} affectedFiles
 * @param {string[]} affectedModules
 * @returns {{order: number, description: string}[]}
 */
function buildImplementationSteps(recommendation, affectedFiles, affectedModules) {
  const template = (recommendation.ruleKey && STEP_TEMPLATES[recommendation.ruleKey]) || DEFAULT_STEP_TEMPLATE;
  const moduleName = affectedModules[0] || "the affected code";
  return template.map((description, index) => ({ order: index + 1, description: description.split("{module}").join(moduleName) }));
}

/**
 * Builds the validation checklist: a fixed baseline plus one entry per reason the selected recommendation
 * cited (grounded, never invented), matching this pipeline's established convention (see
 * implementation-request-engine.js's own buildAcceptanceCriteria()/buildValidationChecklist()).
 * @param {{reason: string[]}} recommendation
 * @returns {string[]}
 */
function buildValidationChecklist(recommendation) {
  const checklist = [
    "Run all relevant automated tests for every affected module.",
    "Run the repository's standard build/lint checks for any changed workspace.",
    "Confirm no behavior change is observable outside the affected modules/files.",
  ];
  for (const reason of recommendation.reason || []) checklist.push(`Addresses the underlying finding: ${reason}`);
  return checklist;
}

/**
 * Builds one rollback target per affected file: a plain, generic version-control revert instruction. No
 * actual git state is inspected or assumed (execution has not happened yet at planning time) -- this is a
 * plan, not a performed action.
 * @param {string[]} affectedFiles
 * @returns {{file: (string|null), method: string}[]}
 */
function buildRollbackTargets(affectedFiles) {
  if (affectedFiles.length === 0) {
    return [{ file: null, method: "No affected files were identified; no file-level rollback target applies." }];
  }
  return affectedFiles.map((file) => ({ file, method: `Revert \`${file}\` via version control (\`git checkout -- ${file}\`) once this change has been committed.` }));
}

/**
 * Identifies this plan's module dependencies: the primary affected module's own coupledModules, as already
 * computed by Engineering Knowledge Engine v1 -- never re-derived.
 * @param {string[]} affectedModules
 * @param {(object|null)} engineeringKnowledge
 * @returns {string[]}
 */
function identifyDependencies(affectedModules, engineeringKnowledge) {
  const primary = affectedModules[0];
  if (!primary) return [];
  const moduleKnowledge = findModuleKnowledge(engineeringKnowledge, primary);
  return moduleKnowledge ? [...(moduleKnowledge.coupledModules || [])] : [];
}

/**
 * Estimates effort deterministically from the recommendation's own estimatedImplementationSize, plus a
 * small, capped adjustment for how many files are affected (more files touched -> more effort), rounded to
 * one decimal hour.
 * @param {{estimatedImplementationSize: string}} recommendation
 * @param {string[]} affectedFiles
 * @returns {{size: string, estimatedHours: number, fileCount: number}}
 */
function estimateEffort(recommendation, affectedFiles) {
  const size = recommendation.estimatedImplementationSize || "Medium";
  const base = EFFORT_BASE_HOURS[size] ?? EFFORT_BASE_HOURS.Medium;
  const extra = Math.min(MAX_EXTRA_HOURS, Math.max(0, affectedFiles.length - 1) * EXTRA_HOURS_PER_FILE);
  return { size, estimatedHours: round1(base + extra), fileCount: affectedFiles.length };
}

function bumpRisk(level) {
  const index = RISK_LEVELS.indexOf(level);
  return index === -1 ? level : RISK_LEVELS[Math.min(index + 1, RISK_LEVELS.length - 1)];
}

/**
 * Estimates risk deterministically, starting from the recommendation's own estimatedRisk and elevating one
 * level (capped at High) for each independently-documented risk factor actually present: 2+ affected
 * modules (cross-module coupling), or a low historical success rate already reported by Adaptive Decision
 * Engine v2's own selectionReason (never re-derived -- read directly from decision.json).
 * @param {{estimatedRisk: string}} recommendation
 * @param {string[]} affectedFiles
 * @param {string[]} affectedModules
 * @param {object} decision parsed adaptive-decision.json
 * @returns {{level: string, factors: string[]}}
 */
function estimateRisk(recommendation, affectedFiles, affectedModules, decision) {
  let level = recommendation.estimatedRisk || "Medium";
  const factors = [`${affectedFiles.length} affected file(s).`, `${affectedModules.length} affected module(s).`];
  if (affectedModules.length >= 2) {
    level = bumpRisk(level);
    factors.push("Risk elevated: change spans 2+ affected modules (cross-module coupling).");
  }
  const reason = decision && decision.selectionReason;
  if (reason && reason.historicalEvidence > 0 && reason.historicalSuccessRate < 50) {
    level = bumpRisk(level);
    factors.push(`Risk elevated: only ${reason.historicalSuccessRate}% historical success rate across ${reason.historicalEvidence} prior attempt(s) of this recommendation.`);
  }
  return { level, factors };
}

/**
 * Fixed completion criteria baseline -- identical for every plan, since these describe what "done" means for
 * ANY execution plan in this pipeline, not something specific to one recommendation.
 * @returns {string[]}
 */
function buildCompletionCriteria() {
  return [
    "All ordered implementation steps have been completed.",
    "Every item in the validation checklist passes.",
    "No behavior change is observable outside the affected modules/files.",
    "The change has been reviewed and approved via pull request.",
  ];
}

function relFrom(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * Builds the complete execution-plan.json document. Pure -- no I/O. This is the single entry point both the
 * CLI and any other caller (e.g. tests) should use. Handles adaptive-decision.json's own honest "no
 * selection" case gracefully (an empty plan, not a failure).
 * @param {object} decision parsed adaptive-decision.json
 * @param {(object|null)} recommendationsDoc parsed recommendations.json, or null
 * @param {(object|null)} repositoryAnalysis parsed repository-analysis.json, or null
 * @param {(object|null)} engineeringKnowledge parsed engineering-knowledge.json, or null
 * @param {{decisionPath: string, recommendationsPath: string, repositoryAnalysisPath: string, engineeringKnowledgePath: string}} sources absolute paths actually used
 * @returns {object} matching execution-plan.json's shape
 */
function generateExecutionPlan(decision, recommendationsDoc, repositoryAnalysis, engineeringKnowledge, sources) {
  const base = {
    generatedFrom: relFrom(sources.decisionPath),
    recommendationsSource: relFrom(sources.recommendationsPath),
    repositoryAnalysisSource: relFrom(sources.repositoryAnalysisPath),
    engineeringKnowledgeSource: relFrom(sources.engineeringKnowledgePath),
    sourceProjectName: decision.sourceProjectName,
    sourceDecisionId: decision.timestamp,
    inputsAvailable: {
      recommendations: recommendationsDoc !== null,
      repositoryAnalysis: repositoryAnalysis !== null,
      engineeringKnowledge: engineeringKnowledge !== null,
    },
    timestamp: new Date().toISOString(),
  };

  const hasSelection = decision.selectedRecommendationId !== null && decision.selectedRecommendationId !== undefined;
  if (!hasSelection) {
    return {
      ...base,
      goal: null,
      selectedRecommendation: null,
      affectedFiles: [],
      affectedModules: [],
      implementationSteps: [],
      validationChecklist: [],
      estimatedEffort: { size: "Not applicable", estimatedHours: 0, fileCount: 0 },
      estimatedRisk: { level: "Not applicable", factors: [] },
      rollbackTargets: [],
      dependencies: [],
      completionCriteria: [],
      nextStep: "No decision was available to plan from; run the pipeline again once Adaptive Decision Engine has selected a recommendation.",
    };
  }

  const recommendation = resolveRecommendation(decision, recommendationsDoc);
  const affectedFiles = identifyAffectedFiles(recommendation, engineeringKnowledge);
  const affectedModules = identifyAffectedModules(recommendation);

  return {
    ...base,
    goal: recommendation.description || recommendation.title,
    selectedRecommendation: { id: recommendation.id, title: recommendation.title },
    affectedFiles,
    affectedModules,
    implementationSteps: buildImplementationSteps(recommendation, affectedFiles, affectedModules),
    validationChecklist: buildValidationChecklist(recommendation),
    estimatedEffort: estimateEffort(recommendation, affectedFiles),
    estimatedRisk: estimateRisk(recommendation, affectedFiles, affectedModules, decision),
    rollbackTargets: buildRollbackTargets(affectedFiles),
    dependencies: identifyDependencies(affectedModules, engineeringKnowledge),
    completionCriteria: buildCompletionCriteria(),
    nextStep: "This execution plan is ready for human review. Once approved, Implementation Request Engine packages it into a formal execution contract.",
  };
}

// ---------------------------------------------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------------------------------------------

/**
 * Renders the human-readable Markdown report for a given execution plan.
 * @param {object} plan result of generateExecutionPlan()
 * @returns {string}
 */
function renderExecutionPlanMarkdown(plan) {
  const lines = [];
  lines.push("# Execution Plan Report", "");
  lines.push(
    "Generated by `scripts/execution-planner.js` -- deterministic, no AI/LLM/embeddings involved. Converts the selected recommendation into an explicit engineering execution plan; it never generates or modifies code.",
    ""
  );
  lines.push(`Source: \`${plan.generatedFrom}\` (project: ${plan.sourceProjectName}, decision ${plan.sourceDecisionId})`, "");
  lines.push(`Timestamp: ${plan.timestamp}`, "");

  if (plan.selectedRecommendation === null) {
    lines.push("## Goal", "");
    lines.push("None. adaptive-decision.json contained no selection to plan from.", "");
    lines.push("## Next Step", "");
    lines.push(plan.nextStep, "");
    return lines.join("\n");
  }

  lines.push("## Goal", "");
  lines.push(plan.goal, "");

  lines.push("## Selected Recommendation", "");
  lines.push(`**#${plan.selectedRecommendation.id} -- ${plan.selectedRecommendation.title}**`, "");

  lines.push("## Affected Modules", "");
  (plan.affectedModules.length ? plan.affectedModules : ["None"]).forEach((name) => lines.push(`- ${name}`));
  lines.push("");

  lines.push("## Affected Files", "");
  (plan.affectedFiles.length ? plan.affectedFiles : ["None"]).forEach((file) => lines.push(`- \`${file}\``));
  lines.push("");

  lines.push("## Ordered Implementation Steps", "");
  plan.implementationSteps.forEach((step) => lines.push(`${step.order}. ${step.description}`));
  lines.push("");

  lines.push("## Validation Checklist", "");
  plan.validationChecklist.forEach((entry) => lines.push(`- [ ] ${entry}`));
  lines.push("");

  lines.push("## Estimated Effort", "");
  lines.push(`- Size: ${plan.estimatedEffort.size}`);
  lines.push(`- Estimated hours: ${plan.estimatedEffort.estimatedHours}`);
  lines.push(`- Files touched: ${plan.estimatedEffort.fileCount}`);
  lines.push("");

  lines.push("## Estimated Risk", "");
  lines.push(`**Level:** ${plan.estimatedRisk.level}`, "");
  plan.estimatedRisk.factors.forEach((factor) => lines.push(`- ${factor}`));
  lines.push("");

  lines.push("## Rollback Targets", "");
  plan.rollbackTargets.forEach((target) => lines.push(`- ${target.file ? `\`${target.file}\`: ` : ""}${target.method}`));
  lines.push("");

  lines.push("## Dependencies", "");
  (plan.dependencies.length ? plan.dependencies : ["None"]).forEach((name) => lines.push(`- ${name}`));
  lines.push("");

  lines.push("## Completion Criteria", "");
  plan.completionCriteria.forEach((entry) => lines.push(`- ${entry}`));
  lines.push("");

  lines.push("## Next Step", "");
  lines.push(plan.nextStep, "");

  return lines.join("\n");
}

/**
 * Writes execution-plan.json and execution-plan.md into the output directory (created if needed).
 * @param {object} plan
 * @param {string} [outDir] defaults to the module's own configured output directory
 * @returns {{jsonPath: string, mdPath: string}}
 */
function writeOutputs(plan, outDir) {
  const dir = outDir || outputDir;
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "execution-plan.json");
  const mdPath = path.join(dir, "execution-plan.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(mdPath, `${renderExecutionPlanMarkdown(plan)}\n`);
  return { jsonPath, mdPath };
}

/**
 * Loads every input, builds the execution plan, and writes both output files. This is the single entry
 * point both the CLI and any other caller (e.g. tests) should use.
 * @param {{decisionPath?: string, recommendationsPath?: string, repositoryAnalysisPath?: string, engineeringKnowledgePath?: string, outputDir?: string}} [overrides]
 *   test-only escape hatch so this function's real logic can be exercised against isolated paths without
 *   needing a fresh module instance (mirrors every other engine's own main(overrides) precedent).
 * @returns {{plan: object, jsonPath: string, mdPath: string}}
 */
function plan(overrides) {
  const opts = overrides || {};
  const sources = {
    decisionPath: opts.decisionPath || decisionPath,
    recommendationsPath: opts.recommendationsPath || recommendationsPath,
    repositoryAnalysisPath: opts.repositoryAnalysisPath || repositoryAnalysisPath,
    engineeringKnowledgePath: opts.engineeringKnowledgePath || engineeringKnowledgePath,
  };

  const decision = loadDecision(sources.decisionPath);
  const recommendationsDoc = loadRecommendations(sources.recommendationsPath);
  const repositoryAnalysis = loadRepositoryAnalysis(sources.repositoryAnalysisPath);
  const engineeringKnowledge = loadEngineeringKnowledge(sources.engineeringKnowledgePath);

  const executionPlan = generateExecutionPlan(decision, recommendationsDoc, repositoryAnalysis, engineeringKnowledge, sources);
  const { jsonPath, mdPath } = writeOutputs(executionPlan, opts.outputDir);
  return { plan: executionPlan, jsonPath, mdPath };
}

function main(overrides) {
  const result = plan(overrides);
  console.log(`Wrote ${path.relative(root, result.jsonPath)}`);
  console.log(`Wrote ${path.relative(root, result.mdPath)}`);
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
  decisionPath,
  recommendationsPath,
  repositoryAnalysisPath,
  engineeringKnowledgePath,
  outputDir,
  STEP_TEMPLATES,
  DEFAULT_STEP_TEMPLATE,
  loadDecision,
  loadRecommendations,
  loadRepositoryAnalysis,
  loadEngineeringKnowledge,
  findRecommendation,
  findModuleKnowledge,
  resolveRecommendation,
  identifyAffectedFiles,
  identifyAffectedModules,
  buildImplementationSteps,
  buildValidationChecklist,
  buildRollbackTargets,
  identifyDependencies,
  estimateEffort,
  estimateRisk,
  buildCompletionCriteria,
  generateExecutionPlan,
  renderExecutionPlanMarkdown,
  writeOutputs,
  plan,
  main,
};
