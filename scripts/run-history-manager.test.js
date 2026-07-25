#!/usr/bin/env node
// Run History Manager v1 regression coverage.
//
// TEST FRAMEWORK NOTE: this repo has no Jest anywhere (no root package.json; every one of the other 12
// engines in this pipeline is tested via plain `node scripts/<engine>.test.js` scripts, run with
// `for f in scripts/*.test.js; do node "$f"; done`). This task asked for "comprehensive Jest tests" but also
// to "follow the same conventions as the existing scripts" and add "no new dependencies unless absolutely
// necessary" -- installing Jest would require a brand-new root package.json/devDependency/config that
// nothing else in scripts/ has, and would make this the only engine in the pipeline whose tests can't run
// via that same one-line loop. Node's own built-in test runner (`node:test` + `node:assert/strict`,
// available with zero new dependencies since Node 18) resolves the conflict: it gives the same
// describe/test/assert structure Jest tests are written in, AND real, tool-reported coverage via
// `node --test --experimental-test-coverage` (satisfying the ">95% coverage" target with an actual measured
// number, not a self-report) -- while requiring nothing new to install and still running as a plain
// `node scripts/run-history-manager.test.js` invocation like every other file in this suite.
//
// Isolation note: unlike most other engines' tests in this suite, most tests below require the real
// scripts/run-history-manager.js ONCE (not a fresh temp-copied module per test) -- every archiving function
// here accepts explicit sourceDir/runsDir arguments, so per-test isolation comes from pointing those at a
// fresh mkdtemp'd directory, not from re-requiring a separate module instance. This also keeps V8's coverage
// instrumentation attributing everything to one real file path instead of fragmenting it across many
// temp-copy paths. Only the standalone CLI (main()) tests need an isolated module copy, since main() reads
// its own module-level root/runsDir (derived from environment variables) rather than taking parameters.
//
// Run with:                         node scripts/run-history-manager.test.js
// Run with coverage:  node --test --experimental-test-coverage scripts/run-history-manager.test.js
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "scripts/run-history-manager.js"), "utf8");
const mod = require(path.join(repoRoot, "scripts/run-history-manager.js"));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "run-history-manager-"));
}

function writeAllArtifacts(sourceDir) {
  for (const { source: relPath } of mod.ARTIFACT_MAP) {
    writeJson(path.join(sourceDir, ...relPath.split("/")), { fixture: true, source: relPath });
  }
}

function baseContext(overrides) {
  return {
    status: "SUCCESS",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:08.421Z",
    durationMs: 8421,
    goal: "Extract Authentication logic into smaller units",
    provider: "stub-deterministic-v1",
    profile: "safe",
    iterations: 2,
    retryCount: 1,
    validationPassed: true,
    validationScore: 93,
    reflectionRetryRecommended: false,
    stageResults: [
      { name: "Repository Intelligence", durationMs: 120 },
      { name: "Recommendation Engine", durationMs: 450 },
    ],
    stdoutEntries: [{ stage: "Repository Intelligence", text: "ok" }],
    stderrEntries: [],
    ...overrides,
  };
}

describe("Run ID generation", () => {
  test("first run (no runs/ directory yet) is RUN-000001", () => {
    const fixtureRoot = makeFixtureRoot();
    assert.equal(mod.getNextRunId(path.join(fixtureRoot, "runs")), "RUN-000001");
  });

  test("second run increments the id", () => {
    const fixtureRoot = makeFixtureRoot();
    fs.mkdirSync(path.join(fixtureRoot, "runs", "RUN-000001"), { recursive: true });
    assert.equal(mod.getNextRunId(path.join(fixtureRoot, "runs")), "RUN-000002");
  });

  test("uses the highest existing run folder, not a count, so gaps are respected", () => {
    const fixtureRoot = makeFixtureRoot();
    fs.mkdirSync(path.join(fixtureRoot, "runs", "RUN-000001"), { recursive: true });
    fs.mkdirSync(path.join(fixtureRoot, "runs", "RUN-000007"), { recursive: true });
    assert.equal(mod.getNextRunId(path.join(fixtureRoot, "runs")), "RUN-000008");
  });

  test("ignores non-run folders and files when scanning for the highest id", () => {
    const fixtureRoot = makeFixtureRoot();
    fs.mkdirSync(path.join(fixtureRoot, "runs", "RUN-000002"), { recursive: true });
    fs.mkdirSync(path.join(fixtureRoot, "runs", "not-a-run-folder"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "runs", "RUN-000099"), "this is a file, not a directory, and must not count");
    assert.equal(mod.getNextRunId(path.join(fixtureRoot, "runs")), "RUN-000003");
  });

  test("never uses a timestamp -- ids are stable, sequential integers regardless of when generated", () => {
    assert.equal(mod.formatRunId(1), "RUN-000001");
    assert.equal(mod.formatRunId(42), "RUN-000042");
    assert.equal(mod.formatRunId(123456), "RUN-123456");
  });
});

describe("Directory and folder creation", () => {
  test("creates runs/ if it does not exist", () => {
    const fixtureRoot = makeFixtureRoot();
    const runsDir = path.join(fixtureRoot, "runs");
    assert.equal(fs.existsSync(runsDir), false);
    mod.archiveRunSync(baseContext({ runsDir, sourceDir: fixtureRoot }));
    assert.equal(fs.existsSync(runsDir), true);
  });

  test("creates a dedicated runs/RUN-000001/ folder for the run", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot }));
    assert.equal(result.runId, "RUN-000001");
    assert.equal(fs.existsSync(result.runDir), true);
    assert.equal(path.basename(result.runDir), "RUN-000001");
  });

  test("nothing is ever overwritten -- two runs get two distinct folders", () => {
    const fixtureRoot = makeFixtureRoot();
    const runsDir = path.join(fixtureRoot, "runs");
    const first = mod.archiveRunSync(baseContext({ runsDir, sourceDir: fixtureRoot }));
    const second = mod.archiveRunSync(baseContext({ runsDir, sourceDir: fixtureRoot }));
    assert.notEqual(first.runDir, second.runDir);
    assert.equal(fs.existsSync(first.runDir), true);
    assert.equal(fs.existsSync(second.runDir), true);
  });
});

describe("Artifact archiving", () => {
  test("archives every artifact that exists, under its documented flattened name", () => {
    const fixtureRoot = makeFixtureRoot();
    writeAllArtifacts(fixtureRoot);
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot }));
    assert.equal(result.archivedFiles.length, mod.ARTIFACT_MAP.length);
    for (const { archiveName } of mod.ARTIFACT_MAP) {
      assert.equal(fs.existsSync(path.join(result.runDir, archiveName)), true, `expected ${archiveName} to be archived`);
    }
    // Reflection Engine's real file is reflection-report.json; this engine archives it under the task's own
    // specified name, reflection.json, without touching Reflection Engine's own frozen contract.
    const archivedReflection = JSON.parse(fs.readFileSync(path.join(result.runDir, "reflection.json"), "utf8"));
    assert.equal(archivedReflection.source, "reflection/reflection-report.json");
  });

  test("ignores missing files -- never fails when only some artifacts exist", () => {
    const fixtureRoot = makeFixtureRoot();
    writeJson(path.join(fixtureRoot, "decision", "decision.json"), { only: "this one exists" });
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot }));
    assert.deepEqual(result.archivedFiles, ["decision.json"]);
    assert.equal(fs.existsSync(path.join(result.runDir, "recommendations.json")), false);
  });

  test("archives nothing (but still succeeds) when no artifacts exist at all", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot }));
    assert.deepEqual(result.archivedFiles, []);
    assert.equal(result.metrics.artifactsArchived, 0);
  });

  test("archived file content is copied verbatim, byte for byte", () => {
    const fixtureRoot = makeFixtureRoot();
    writeJson(path.join(fixtureRoot, "execution", "execution.json"), { status: "success", modifiedFiles: ["a.js", "b.js"] });
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot }));
    const archived = JSON.parse(fs.readFileSync(path.join(result.runDir, "execution.json"), "utf8"));
    assert.deepEqual(archived, { status: "success", modifiedFiles: ["a.js", "b.js"] });
  });

  test("stdout.log and stderr.log are written even when empty, and render captured entries when present", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(
      baseContext({
        runsDir: path.join(fixtureRoot, "runs"),
        sourceDir: fixtureRoot,
        stdoutEntries: [{ stage: "Repository Intelligence", text: "wrote analysis" }],
        stderrEntries: [{ stage: "Implementation Executor", text: "blocked: no approval" }],
      })
    );
    const stdout = fs.readFileSync(path.join(result.runDir, "stdout.log"), "utf8");
    const stderr = fs.readFileSync(path.join(result.runDir, "stderr.log"), "utf8");
    assert.match(stdout, /Repository Intelligence/);
    assert.match(stdout, /wrote analysis/);
    assert.match(stderr, /blocked: no approval/);

    const empty = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot, stdoutEntries: [], stderrEntries: [] }));
    assert.equal(fs.readFileSync(path.join(empty.runDir, "stdout.log"), "utf8"), "");
  });
});

describe("metadata.json generation", () => {
  test("includes every documented field, grounded in the real context", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot }));
    const metadata = JSON.parse(fs.readFileSync(path.join(result.runDir, "metadata.json"), "utf8"));
    assert.equal(metadata.runId, "RUN-000001");
    assert.equal(metadata.status, "SUCCESS");
    assert.equal(metadata.startedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(metadata.finishedAt, "2026-01-01T00:00:08.421Z");
    assert.equal(metadata.durationMs, 8421);
    assert.equal(metadata.goal, "Extract Authentication logic into smaller units");
    assert.equal(metadata.provider, "stub-deterministic-v1");
    assert.equal(metadata.profile, "safe");
    assert.equal(metadata.iterations, 2);
  });

  test("defaults goal/provider/profile to null rather than inventing a value", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot, goal: undefined, provider: undefined, profile: undefined }));
    assert.equal(result.metadata.goal, null);
    assert.equal(result.metadata.provider, null);
    assert.equal(result.metadata.profile, null);
  });
});

describe("metrics.json generation", () => {
  test("includes every documented field, grounded in the real context", () => {
    const fixtureRoot = makeFixtureRoot();
    writeAllArtifacts(fixtureRoot);
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot }));
    assert.deepEqual(result.metrics, {
      iterations: 2,
      retryCount: 1,
      artifactsArchived: mod.ARTIFACT_MAP.length,
      validationPassed: true,
      validationScore: 93,
      reflectionRetryRecommended: false,
      durationMs: 8421,
    });
  });

  test("artifactsArchived always reflects what was actually copied, never the full known list", () => {
    const fixtureRoot = makeFixtureRoot();
    writeJson(path.join(fixtureRoot, "decision", "decision.json"), {});
    writeJson(path.join(fixtureRoot, "validation", "validation.json"), {});
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot }));
    assert.equal(result.metrics.artifactsArchived, 2);
  });
});

describe("timeline.json generation", () => {
  test("captures every stage the caller recorded, in order, with its duration", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(
      baseContext({
        runsDir: path.join(fixtureRoot, "runs"),
        sourceDir: fixtureRoot,
        stageResults: [
          { name: "Repository Intelligence", durationMs: 120 },
          { name: "Recommendation Engine", durationMs: 450 },
          { name: "Implementation Executor", durationMs: 3000 },
        ],
      })
    );
    assert.deepEqual(result.timeline, [
      { stage: "Repository Intelligence", durationMs: 120 },
      { stage: "Recommendation Engine", durationMs: 450 },
      { stage: "Implementation Executor", durationMs: 3000 },
    ]);
  });

  test("is an empty array, not an error, when no stage results are supplied", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot, stageResults: undefined }));
    assert.deepEqual(result.timeline, []);
  });

  test("null-durationMs stages (e.g. a skipped stage, if ever passed through) render as null, never fabricated", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(
      baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot, stageResults: [{ name: "Pull Request Generator", durationMs: null }] })
    );
    assert.deepEqual(result.timeline, [{ stage: "Pull Request Generator", durationMs: null }]);
  });
});

describe("run-summary.md generation", () => {
  test("includes every field named in the spec", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot }));
    const markdown = fs.readFileSync(path.join(result.runDir, "run-summary.md"), "utf8");
    for (const expected of ["# Run Summary", "Run ID", "Status", "Goal", "Provider", "Iterations", "Validation Score", "Retry Count", "Artifacts Archived", "Duration", "Reflection Decision"]) {
      assert.match(markdown, new RegExp(expected), `expected run-summary.md to mention "${expected}"`);
    }
    assert.match(markdown, /RUN-000001/);
    assert.match(markdown, /93/);
  });

  test("reports the reflection decision in both directions", () => {
    const fixtureRoot = makeFixtureRoot();
    const retryResult = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot, reflectionRetryRecommended: true }));
    assert.match(fs.readFileSync(path.join(retryResult.runDir, "run-summary.md"), "utf8"), /Retry recommended/);
    const noRetryResult = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot, reflectionRetryRecommended: false }));
    assert.match(fs.readFileSync(path.join(noRetryResult.runDir, "run-summary.md"), "utf8"), /No retry recommended/);
  });

  test("renders \"N/A\" for validation score and \"None\" for goal/provider when absent, never fabricating a value", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot, goal: undefined, provider: undefined, validationScore: undefined }));
    const markdown = fs.readFileSync(path.join(result.runDir, "run-summary.md"), "utf8");
    assert.match(markdown, /Validation Score:\*\* N\/A/);
    assert.match(markdown, /Goal:\*\* None/);
    assert.match(markdown, /Provider:\*\* None/);
  });
});

describe("history generation after a failed validation", () => {
  test("still archives whatever exists and reports the failure honestly, never fabricating success", () => {
    const fixtureRoot = makeFixtureRoot();
    writeJson(path.join(fixtureRoot, "execution", "execution.json"), { status: "success" });
    writeJson(path.join(fixtureRoot, "validation", "validation.json"), { status: "rejected", score: 33, approvedForPR: false });
    const result = mod.archiveRunSync(
      baseContext({
        runsDir: path.join(fixtureRoot, "runs"),
        sourceDir: fixtureRoot,
        status: "FAILED",
        validationPassed: false,
        validationScore: 33,
        reflectionRetryRecommended: false,
      })
    );
    assert.equal(result.metadata.status, "FAILED");
    assert.equal(result.metrics.validationPassed, false);
    assert.equal(result.metrics.validationScore, 33);
    assert.equal(fs.existsSync(path.join(result.runDir, "validation.json")), true);
    assert.equal(fs.existsSync(path.join(result.runDir, "metadata.json")), true);
  });
});

describe("history generation after a retry", () => {
  test("reports the real iteration/retry counts and marks the reflection decision that caused them", () => {
    const fixtureRoot = makeFixtureRoot();
    const result = mod.archiveRunSync(
      baseContext({
        runsDir: path.join(fixtureRoot, "runs"),
        sourceDir: fixtureRoot,
        iterations: 3,
        retryCount: 2,
        reflectionRetryRecommended: true,
        stageResults: [
          { name: "Implementation Executor", durationMs: 100 },
          { name: "Validation Engine", durationMs: 50 },
          { name: "Reflection Engine", durationMs: 10 },
          { name: "Implementation Executor", durationMs: 120 },
          { name: "Validation Engine", durationMs: 55 },
          { name: "Reflection Engine", durationMs: 11 },
          { name: "Implementation Executor", durationMs: 90 },
          { name: "Validation Engine", durationMs: 48 },
          { name: "Reflection Engine", durationMs: 9 },
        ],
      })
    );
    assert.equal(result.metadata.iterations, 3);
    assert.equal(result.metrics.retryCount, 2);
    assert.equal(result.timeline.length, 9);
    assert.equal(result.timeline.filter((entry) => entry.stage === "Implementation Executor").length, 3);
  });
});

describe("orchestrator integration (simulated real orchestrator-shaped call)", () => {
  test("accepts the exact context shape the orchestrator builds and produces a complete archive", () => {
    const fixtureRoot = makeFixtureRoot();
    writeAllArtifacts(fixtureRoot);
    // Mirrors exactly what scripts/autonomous-orchestrator.js assembles: real stage-result objects (with
    // extra fields like status/exitCode it doesn't need), env-var-sourced goal/provider/profile, and the
    // final loop outcome.
    const orchestratorShapedContext = {
      runsDir: path.join(fixtureRoot, "runs"),
      sourceDir: fixtureRoot,
      status: "SUCCESS",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1000,
      goal: null,
      provider: "stub-deterministic-v1",
      profile: null,
      iterations: 1,
      retryCount: 0,
      validationPassed: true,
      validationScore: 100,
      reflectionRetryRecommended: false,
      stageResults: [
        { name: "Repository Intelligence", script: "repository-intelligence.js", status: "PASS", exitCode: 0, durationMs: 100 },
        { name: "Implementation Executor", script: "implementation-executor.js", status: "PASS", exitCode: 0, durationMs: 50 },
      ],
      stdoutEntries: [{ stage: "Repository Intelligence", text: "ok: repository-intelligence.js" }],
      stderrEntries: [],
    };
    const result = mod.archiveRunSync(orchestratorShapedContext);
    assert.equal(result.runId, "RUN-000001");
    assert.equal(result.timeline.length, 2);
    assert.equal(result.archivedFiles.length, mod.ARTIFACT_MAP.length);
  });
});

describe("async API (fs/promises)", () => {
  test("archiveRun produces the same result shape as archiveRunSync for the same context", async () => {
    const fixtureRoot = makeFixtureRoot();
    writeAllArtifacts(fixtureRoot);
    const context = baseContext({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot });
    const asyncResult = await mod.archiveRun(context);
    assert.equal(asyncResult.runId, "RUN-000001");
    assert.equal(asyncResult.archivedFiles.length, mod.ARTIFACT_MAP.length);
    assert.equal(fs.existsSync(path.join(asyncResult.runDir, "metadata.json")), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(asyncResult.runDir, "metadata.json"), "utf8")), asyncResult.metadata);
  });

  test("archiveRun also ignores missing files and increments ids across calls", async () => {
    const fixtureRoot = makeFixtureRoot();
    const runsDir = path.join(fixtureRoot, "runs");
    const first = await mod.archiveRun(baseContext({ runsDir, sourceDir: fixtureRoot }));
    const second = await mod.archiveRun(baseContext({ runsDir, sourceDir: fixtureRoot }));
    assert.equal(first.runId, "RUN-000001");
    assert.equal(second.runId, "RUN-000002");
    assert.deepEqual(first.archivedFiles, []);
  });
});

describe("standalone CLI (main())", () => {
  test("main() archives using environment-sourced metadata, against the real module (isolated via overrides)", async () => {
    const fixtureRoot = makeFixtureRoot();
    writeJson(path.join(fixtureRoot, "decision", "decision.json"), { fixture: true });

    const previousEnv = { ...process.env };
    process.env.RUN_STATUS = "success";
    process.env.GVAMS_GOAL = "test goal";
    process.env.EXECUTION_PROVIDER = "stub-deterministic-v1";
    process.env.RUN_ITERATIONS = "1";
    process.env.RUN_VALIDATION_PASSED = "true";
    process.env.RUN_VALIDATION_SCORE = "88";
    try {
      const result = await mod.main({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot });
      assert.equal(result.metadata.status, "SUCCESS");
      assert.equal(result.metadata.goal, "test goal");
      assert.equal(result.metadata.provider, "stub-deterministic-v1");
      assert.equal(result.metrics.validationScore, 88);
      assert.equal(result.metrics.validationPassed, true);
      assert.equal(result.archivedFiles.length, 1);
    } finally {
      process.env = previousEnv;
    }
  });

  test("main() defaults status to UNKNOWN and leaves optional fields null/zero when nothing is set", async () => {
    const fixtureRoot = makeFixtureRoot();
    const previousEnv = { ...process.env };
    for (const key of ["RUN_STATUS", "GVAMS_GOAL", "EXECUTION_PROVIDER", "GVAMS_PROFILE", "RUN_ITERATIONS", "RUN_VALIDATION_PASSED", "RUN_VALIDATION_SCORE", "RUN_REFLECTION_RETRY"]) {
      delete process.env[key];
    }
    try {
      const result = await mod.main({ runsDir: path.join(fixtureRoot, "runs"), sourceDir: fixtureRoot });
      assert.equal(result.metadata.status, "UNKNOWN");
      assert.equal(result.metadata.goal, null);
      assert.equal(result.metrics.validationScore, null);
      assert.equal(result.metrics.validationPassed, false);
    } finally {
      process.env = previousEnv;
    }
  });

  test("the real CLI subprocess runs end to end and writes a run folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-history-manager-cli-"));
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts/run-history-manager.js"), source);
    writeJson(path.join(dir, "decision", "decision.json"), { fixture: true });
    const result = spawnSync("node", ["scripts/run-history-manager.js"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, RUN_STATUS: "success", GVAMS_GOAL: "cli test goal" },
    });
    assert.equal(result.status, 0, `expected the CLI to succeed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /RUN-000001/);
    const runFolders = fs.readdirSync(path.join(dir, "runs"));
    assert.equal(runFolders.length, 1);
  });
});

describe("failure isolation (never throws for a missing directory)", () => {
  test("collectPresentArtifacts and renderLog handle empty/undefined input gracefully", () => {
    assert.deepEqual(mod.collectPresentArtifacts(path.join(os.tmpdir(), "definitely-does-not-exist-xyz")), []);
    assert.equal(mod.renderLog(undefined), "");
    assert.equal(mod.renderLog([]), "");
    assert.equal(mod.renderLog([{ stage: "X", text: "" }]), "");
  });
});

console.log("All Run History Manager v1 regression scenarios passed (run under node:test).");
