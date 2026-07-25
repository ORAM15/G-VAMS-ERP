#!/usr/bin/env node
// Reflection Engine v1
//
// A deterministic engine that reads only validation/validation.json (Validation Engine v1's own output --
// see the NAMING NOTE below) and decides whether another implementation attempt is recommended, producing a
// refined implementation objective for that next attempt if so. It never generates code, never modifies any
// implementation artifact, never invokes AI, and never inspects the repository. Its only job is triage:
// interpret an already-computed validation result and recommend what to do next.
//
// NAMING NOTE: this engine's task described its input as "validation/validation-report.json". No engine in
// this pipeline produces a file by that exact name -- Validation Engine v1 (frozen; its contract must be
// preserved, not renamed) writes validation/validation.json. This engine therefore reads that real file,
// via the SAME environment variable name (VALIDATION_PATH) Pull Request Generator v1 already uses for it --
// reusing an existing, real contract rather than inventing a new path for the same file.
//
// Run with:   node scripts/reflection-engine.js
// Input path defaults to validation/validation.json; override with VALIDATION_PATH (relative to the
// repository root, or absolute).
// Output dir defaults to `reflection/` at the repository root; override with REFLECTION_OUTPUT_DIR.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const validationPath = path.resolve(root, process.env.VALIDATION_PATH || "validation/validation.json");
const outputDir = path.resolve(root, process.env.REFLECTION_OUTPUT_DIR || "reflection");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Validates that a parsed validation.json has the shape this engine depends on. Fails closed with a clear,
 * actionable error on anything malformed -- this engine never guesses at a missing or corrupted status.
 * @param {object} validation
 */
function assertValidValidationShape(validation) {
  if (typeof validation !== "object" || validation === null || Array.isArray(validation)) {
    throw new Error(`validation.json at ${path.relative(root, validationPath)} is not a valid validation report object. Run \`node scripts/validation-engine.js\` again.`);
  }
  if (!["approved", "rejected", "skipped"].includes(validation.status)) {
    throw new Error(
      `validation.json at ${path.relative(root, validationPath)} has an unrecognized status "${validation.status}"; expected "approved", "rejected", or "skipped". Run \`node scripts/validation-engine.js\` again.`
    );
  }
  if (!Array.isArray(validation.rules)) {
    throw new Error(`validation.json at ${path.relative(root, validationPath)} has a non-array rules field. Run \`node scripts/validation-engine.js\` again.`);
  }
}

/**
 * Loads, parses, and structurally validates validation.json. Fails closed with a clear, actionable error if
 * the file is missing, not valid JSON, or structurally invalid. Never writes to this file, or to any other
 * implementation artifact -- this engine only ever reads validation.json.
 * @param {string} file absolute path to validation.json
 * @returns {object} the parsed, validated validation report
 */
function loadValidation(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`validation.json not found at ${path.relative(root, file)}. Run \`node scripts/validation-engine.js\` first (or set VALIDATION_PATH).`);
  }
  let validation;
  try {
    validation = readJson(file);
  } catch (error) {
    throw new Error(`validation.json at ${path.relative(root, file)} is not valid JSON: ${error.message}`);
  }
  assertValidValidationShape(validation);
  return validation;
}

// ---------------------------------------------------------------------------------------------------------
// Retry decision + refined objective -- both deterministic, both derived only from validation.json's own
// structured rules array (never from free-text `details` strings, which are for humans, not for this
// engine's own logic to parse).
// ---------------------------------------------------------------------------------------------------------

// One deterministic, fixed sentence fragment per rule id -- reused verbatim, never invented per-run. RULE-006
// (execution policy) is deliberately absent here: a policy violation is never something another automated
// implementation attempt can fix (see decideRetry()), so it never contributes to a retry objective.
const OBJECTIVE_FRAGMENTS = {
  "RULE-001": "ensure the implementation actually completes execution successfully",
  "RULE-002": "modify only the files explicitly listed in the implementation request's affected files -- no out-of-scope changes",
  "RULE-003": "ensure the required automated tests are actually executed",
  "RULE-004": "fix the implementation so every executed test passes, without breaking any currently-passing test",
  "RULE-005": "ensure the provider returns complete, well-formed execution evidence",
};

/**
 * Decides whether another implementation attempt is recommended, purely from validation.json's own status
 * and structured rules array:
 *   - "approved"           -> no retry needed, the change is already good.
 *   - "skipped"             -> nothing was executed upstream; there is nothing to retry.
 *   - "rejected", RULE-006 failed -> a policy violation; only a human/config action fixes this, never a
 *                              retry (a different implementation attempt cannot change what the request's
 *                              own executionPolicy declares, or record a human's approval).
 *   - "rejected", otherwise -> retryable: at least one fixable rule failed.
 * @param {{status: string, rules: {id: string, description: string, status: string}[]}} validation
 * @returns {{retryRecommended: boolean, reason: string, failedRules: {id: string, description: string}[]}}
 */
function decideRetry(validation) {
  const failedRules = validation.rules.filter((rule) => rule.status === "FAIL").map((rule) => ({ id: rule.id, description: rule.description }));

  if (validation.status === "approved") {
    return { retryRecommended: false, reason: "Validation approved this change for a pull request; no further implementation attempt is needed.", failedRules: [] };
  }
  if (validation.status === "skipped") {
    return {
      retryRecommended: false,
      reason: "Nothing was executed (no recommendation was selected upstream); there is nothing to retry. Re-run the pipeline once Decision Engine has selected a recommendation.",
      failedRules: [],
    };
  }

  // validation.status === "rejected"
  if (failedRules.some((rule) => rule.id === "RULE-006")) {
    return {
      retryRecommended: false,
      reason:
        "Execution policy was not respected (RULE-006 failed). This requires a human or configuration action -- such as recording approval or adjusting the requested permissions -- not another automated implementation attempt.",
      failedRules,
    };
  }
  if (failedRules.length === 0) {
    return {
      retryRecommended: false,
      reason: 'validation.json reports status "rejected" but no rule actually failed; this is a contradictory validation record. Re-run Validation Engine before attempting another implementation.',
      failedRules,
    };
  }
  return {
    retryRecommended: true,
    reason: `Validation rejected this change due to ${failedRules.length} failed rule(s): ${failedRules.map((rule) => rule.id).join(", ")}. Another implementation attempt is recommended.`,
    failedRules,
  };
}

/**
 * Builds the refined implementation objective for the next iteration: a fixed sentence fragment per failed,
 * fixable rule, joined into one instruction. Returns null whenever no retry is recommended, or when none of
 * the failed rules have a known objective fragment (never fabricates guidance for a rule it doesn't
 * recognize). This objective is informational in v1 -- no current frozen engine accepts it as an input
 * override yet (Implementation Executor always reads the same static implementation-request.json), so it is
 * surfaced for a human (or a future engine) to act on, not mechanically injected into the next attempt.
 * @param {{retryRecommended: boolean, failedRules: {id: string}[]}} retryDecision result of decideRetry()
 * @returns {(string|null)}
 */
function buildNextObjective(retryDecision) {
  if (!retryDecision.retryRecommended) return null;
  const fragments = retryDecision.failedRules.map((rule) => OBJECTIVE_FRAGMENTS[rule.id]).filter(Boolean);
  if (fragments.length === 0) return null;
  return `On the next implementation attempt: ${fragments.join("; ")}.`;
}

/**
 * Builds the complete reflection report. This is the single entry point both the CLI and any other caller
 * (e.g. tests) should use.
 * @param {object} validation parsed validation.json
 * @returns {object} matching reflection-report.json's shape
 */
function buildReflectionReport(validation) {
  const retryDecision = decideRetry(validation);
  return {
    generatedFrom: path.relative(root, validationPath).split(path.sep).join("/"),
    validationStatus: validation.status,
    validationScore: validation.score,
    retryRecommended: retryDecision.retryRecommended,
    reason: retryDecision.reason,
    failedRules: retryDecision.failedRules,
    nextObjective: buildNextObjective(retryDecision),
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------------------------------------------

/**
 * Renders the human-readable Markdown report for a given reflection record.
 * @param {object} reflection result of buildReflectionReport()
 * @returns {string}
 */
function renderMarkdown(reflection) {
  const lines = [];
  lines.push("# Reflection Engine Report", "");
  lines.push(
    "Generated by `scripts/reflection-engine.js` -- deterministic, no AI/LLM involved, no repository inspection. This engine only reads validation.json and decides whether another implementation attempt is recommended; it never generates code and never modifies any implementation artifact.",
    ""
  );
  lines.push(`Source: \`${reflection.generatedFrom}\``, "");
  lines.push(`Timestamp: ${reflection.timestamp}`, "");

  lines.push("## Validation Status", "");
  lines.push(`**${reflection.validationStatus}** (score ${reflection.validationScore}/100)`, "");

  lines.push("## Retry Recommended", "");
  lines.push(reflection.retryRecommended ? "**Yes**" : "**No**", "");

  lines.push("## Reason", "");
  lines.push(reflection.reason, "");

  lines.push("## Failed Rules", "");
  (reflection.failedRules.length ? reflection.failedRules : ["None"]).forEach((rule) => lines.push(typeof rule === "string" ? `- ${rule}` : `- ${rule.id}: ${rule.description}`));
  lines.push("");

  lines.push("## Next Objective", "");
  lines.push(reflection.nextObjective || "None.", "");

  lines.push("## Next Step", "");
  lines.push(
    reflection.retryRecommended
      ? "Run Implementation Executor again (optionally with a different provider via --provider) with this objective in mind, then re-run Validation Engine."
      : "No further automated implementation attempt is recommended. Review the reason above for what to do next.",
    ""
  );

  return lines.join("\n");
}

/**
 * Writes reflection-report.json and reflection-report.md into the output directory (created if needed),
 * returning their absolute paths.
 * @param {object} reflection
 * @returns {{jsonPath: string, mdPath: string}}
 */
function writeOutputs(reflection) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "reflection-report.json");
  const mdPath = path.join(outputDir, "reflection-report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(reflection, null, 2)}\n`);
  fs.writeFileSync(mdPath, `${renderMarkdown(reflection)}\n`);
  return { jsonPath, mdPath };
}

function main() {
  const validation = loadValidation(validationPath);
  const reflection = buildReflectionReport(validation);
  const { jsonPath, mdPath } = writeOutputs(reflection);
  console.log(`Wrote ${path.relative(root, jsonPath)}`);
  console.log(`Wrote ${path.relative(root, mdPath)}`);
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
  validationPath,
  outputDir,
  OBJECTIVE_FRAGMENTS,
  loadValidation,
  decideRetry,
  buildNextObjective,
  buildReflectionReport,
  renderMarkdown,
  writeOutputs,
};
