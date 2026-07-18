#!/usr/bin/env node
// Phase 2K backlog lifecycle regression coverage: a completed backlog item (Status: done in
// .agent/BACKLOG.md) must never be re-selectable by the Decision Gate, completion may only ever be recorded
// by the deterministic post-merge scripts/agent-backlog-reconcile.js (never by the implementation runtime,
// Result Gate, or branch publication alone), and generated context must clearly distinguish open vs
// completed items without itself being the enforcement boundary.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const gatekeeperSource = fs.readFileSync(path.join(repoRoot, "scripts/agent-gatekeeper.js"), "utf8");
const reconcileSource = fs.readFileSync(path.join(repoRoot, "scripts/agent-backlog-reconcile.js"), "utf8");
const contextSource = fs.readFileSync(path.join(repoRoot, "scripts/autonomous-agent-context.js"), "utf8");
const branchPublishSource = fs.readFileSync(path.join(repoRoot, "scripts/agent-branch-publish.js"), "utf8");

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

const SAMPLE_BACKLOG = [
  "# Autonomous Engineering Backlog",
  "",
  "Status values: `open`, `in-progress`, `blocked`, `done`, `rejected`.",
  "",
  "## Items",
  "",
  "### AE-BL-001",
  "",
  "- **Priority:** HIGH",
  "- **Status:** open",
  "",
  "### AE-BL-002",
  "",
  "- **Priority:** HIGH",
  "- **Status:** open",
  "",
  "### AE-BL-003",
  "",
  "- **Priority:** LOW",
  "- **Status:** rejected",
  "",
  "### AE-BL-004",
  "",
  "- **Priority:** LOW",
  "- **Status:** in-progress",
  ""
].join("\n");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-backlog-lifecycle-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/agent-gatekeeper.js"), gatekeeperSource);
  fs.writeFileSync(path.join(dir, "scripts/agent-backlog-reconcile.js"), reconcileSource);
  fs.writeFileSync(path.join(dir, "scripts/autonomous-agent-context.js"), contextSource);
  writeFile(path.join(dir, ".agent/BACKLOG.md"), SAMPLE_BACKLOG);
  writeJson(path.join(dir, ".agent/DAILY_DECISIONS.json"), { schema_version: 1, cycles: [] });
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.email", "test@example.com"], dir);
  run("git", ["config", "user.name", "Test User"], dir);
  writeFile(path.join(dir, "frontend/src/App.js"), "base\n");
  run("git", ["add", "."], dir);
  run("git", ["commit", "-q", "-m", "base"], dir);
  return dir;
}

function recordBase(dir) {
  const result = spawnSync("node", ["scripts/agent-gatekeeper.js", "record-base"], { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`record-base failed:\nSTDOUT:${result.stdout}\nSTDERR:${result.stderr}`);
}

function decisionFixture(overrides) {
  return {
    cycle_id: "AE-2026-07-19-001",
    selected_improvement: "test improvement",
    selection_reason: "test",
    declared_scope: "frontend/src/App.js",
    allowed_paths: ["frontend/src/App.js"],
    forbidden_paths: [],
    planned_validation: ["node --check scripts/agent-gatekeeper.js"],
    risk_level: "low",
    ...overrides
  };
}

function writeDecision(dir, overrides) {
  const decisionFile = path.join(dir, ".agent/runtime/current-decision.json");
  writeJson(decisionFile, decisionFixture(overrides));
  return decisionFile;
}

function decisionGate(dir) {
  return spawnSync("node", ["scripts/agent-gatekeeper.js", "decision", ".agent/runtime/current-decision.json"], { cwd: dir, encoding: "utf8" });
}

function diffGate(dir) {
  return spawnSync("node", ["scripts/agent-gatekeeper.js", "diff", ".agent/runtime/current-decision.json"], { cwd: dir, encoding: "utf8" });
}

function ok(name) {
  console.log(`${name}: observed expected deterministic outcome`);
}

function readBacklog(dir) {
  return fs.readFileSync(path.join(dir, ".agent/BACKLOG.md"), "utf8");
}

// 1. A completed (done) backlog item cannot be selected again -- the Decision Gate fails closed.
{
  const dir = makeRepo();
  writeFile(path.join(dir, ".agent/BACKLOG.md"), SAMPLE_BACKLOG.replace("### AE-BL-002\n\n- **Priority:** HIGH\n- **Status:** open", "### AE-BL-002\n\n- **Priority:** HIGH\n- **Status:** done\n- **Completion evidence:** cycle `AE-2026-07-01-001`, PR #1, merge commit `1111111111111111111111111111111111111`"));
  writeDecision(dir, { selected_backlog_id: "AE-BL-002" });
  const gate = decisionGate(dir);
  if (gate.status === 0) throw new Error(`expected Decision Gate to reject re-selection of a done backlog item, but it passed:\n${gate.stdout}`);
  if (!/AE-BL-002 which \.agent\/BACKLOG\.md already records as done/.test(gate.stderr)) {
    throw new Error(`expected clear diagnostic naming the completed backlog item, got:\n${gate.stderr}`);
  }
  ok("Decision Gate rejects re-selection of a completed (done) backlog item");
}

// 2. An open backlog item remains selectable.
{
  const dir = makeRepo();
  writeDecision(dir, { selected_backlog_id: "AE-BL-001" });
  const gate = decisionGate(dir);
  if (gate.status !== 0) throw new Error(`expected open backlog item to remain selectable:\n${gate.stdout}\n${gate.stderr}`);
  ok("open backlog item remains selectable by the Decision Gate");
}

// 3. A repository-observed improvement without a backlog ID remains supported, even while completed items exist.
{
  const dir = makeRepo();
  writeFile(path.join(dir, ".agent/BACKLOG.md"), SAMPLE_BACKLOG.replace("### AE-BL-002\n\n- **Priority:** HIGH\n- **Status:** open", "### AE-BL-002\n\n- **Priority:** HIGH\n- **Status:** done\n- **Completion evidence:** cycle `AE-2026-07-01-001`, PR #1, merge commit `1111111111111111111111111111111111111`"));
  writeDecision(dir, { selected_backlog_id: null, repository_observed_improvement: "Improve something not tracked in the backlog." });
  const gate = decisionGate(dir);
  if (gate.status !== 0) throw new Error(`expected repository-observed improvement without a backlog id to remain supported:\n${gate.stdout}\n${gate.stderr}`);
  ok("repository-observed improvement without a backlog id remains selectable");
}

// 4. A successful implementation delta alone (Diff Gate passing on a real, in-scope, non-backlog change)
//    never marks any backlog item done -- only scripts/agent-backlog-reconcile.js can ever do that.
{
  const dir = makeRepo();
  recordBase(dir);
  writeDecision(dir, { selected_backlog_id: "AE-BL-001" });
  writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
  const before = readBacklog(dir);
  const gate = diffGate(dir);
  if (gate.status !== 0) throw new Error(`expected Diff Gate to pass for an ordinary in-scope change:\n${gate.stdout}\n${gate.stderr}`);
  const after = readBacklog(dir);
  if (before !== after) throw new Error("a successful implementation delta alone must never modify .agent/BACKLOG.md");
  ok("a successful implementation delta alone does not mark any backlog item done");
}

// 5. Result Gate success alone does not mark any backlog item done (Result Gate never touches BACKLOG.md).
{
  if (/BACKLOG/.test(gatekeeperSource.slice(gatekeeperSource.indexOf("function validateResult"), gatekeeperSource.indexOf("function validateResult") + 1400))) {
    throw new Error("validateResult() must never reference .agent/BACKLOG.md; only reconciliation after a confirmed merge may record completion");
  }
  ok("Result Gate success alone does not mark any backlog item done (validateResult never references BACKLOG.md)");
}

// 6. Branch publication alone does not mark any backlog item done.
{
  if (/BACKLOG/.test(branchPublishSource)) {
    throw new Error("agent-branch-publish.js must never reference .agent/BACKLOG.md; branch publication alone must not affect backlog completion state");
  }
  ok("branch publication alone does not mark any backlog item done (agent-branch-publish.js never references BACKLOG.md)");
}

// 7. Merged/integrated completion evidence (running the reconciliation script, as the post-merge workflow
//    does) marks only the correct backlog item done -- sibling items are left completely untouched.
{
  const dir = makeRepo();
  writeJson(path.join(dir, ".agent/runtime/current-decision.json"), decisionFixture({ cycle_id: "AE-2026-07-19-002", selected_backlog_id: "AE-BL-001" }));
  writeJson(path.join(dir, ".agent/runtime/runtime-result.json"), {
    cycle_id: "AE-2026-07-19-002",
    runtime: "openhands",
    implementation_summary: "test",
    changed_files: ["frontend/src/App.js"],
    validation: [],
    outcome: "success",
    known_limitations: "none",
    recommended_next_direction: "none"
  });
  const reconcile = require(path.join(dir, "scripts/agent-backlog-reconcile.js"));
  const cwdBefore = process.cwd();
  process.chdir(dir);
  try {
    const outcome = reconcile.reconcile("42", "2".repeat(40), "agent/AE-2026-07-19-002");
    if (!outcome.reconciled || outcome.backlogId !== "AE-BL-001") throw new Error(`expected AE-BL-001 to be reconciled, got: ${JSON.stringify(outcome)}`);
  } finally {
    process.chdir(cwdBefore);
  }
  const after = readBacklog(dir);
  const gatekeeper = require(path.join(dir, "scripts/agent-gatekeeper.js"));
  const statuses = gatekeeper.backlogStatuses(after);
  if (statuses["AE-BL-001"] !== "done") throw new Error(`expected AE-BL-001 to be done, got ${statuses["AE-BL-001"]}`);
  if (statuses["AE-BL-002"] !== "open") throw new Error(`sibling AE-BL-002 must remain untouched (open), got ${statuses["AE-BL-002"]}`);
  if (statuses["AE-BL-003"] !== "rejected") throw new Error(`sibling AE-BL-003 must remain untouched (rejected), got ${statuses["AE-BL-003"]}`);
  if (statuses["AE-BL-004"] !== "in-progress") throw new Error(`sibling AE-BL-004 must remain untouched (in-progress), got ${statuses["AE-BL-004"]}`);
  ok("reconciliation marks only the correct backlog item done, siblings are left completely untouched");
}

// 8. AE-BL-002 historical reconciliation is correct on the real repository state produced by this hotfix.
{
  const realBacklog = fs.readFileSync(path.join(repoRoot, ".agent/BACKLOG.md"), "utf8");
  const gatekeeper = require(path.join(repoRoot, "scripts/agent-gatekeeper.js"));
  const items = gatekeeper.parseBacklogItems(realBacklog);
  const ae002 = items.find((item) => item.id === "AE-BL-002");
  if (!ae002 || ae002.status !== "done") throw new Error(`expected the real repository's AE-BL-002 to be recorded as done, got: ${ae002 && ae002.status}`);
  const block = realBacklog.slice(ae002.start, ae002.end);
  if (!/AE-2026-07-17-001/.test(block) || !/PR #38/.test(block) || !/777af5a/.test(block)) {
    throw new Error(`expected AE-BL-002's completion evidence to cite cycle AE-2026-07-17-001, PR #38, and merge commit 777af5a..., got block:\n${block}`);
  }
  for (const id of ["AE-BL-001", "AE-BL-003", "AE-BL-004", "AE-BL-005", "AE-BL-006", "AE-BL-007"]) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.status !== "open") throw new Error(`unrelated backlog item ${id} must remain open, got: ${item && item.status}`);
  }
  ok("AE-BL-002 is correctly reconciled as done with auditable evidence; unrelated backlog items remain open");
}

// 9. Generated context clearly distinguishes open and completed backlog items.
{
  const dir = makeRepo();
  writeFile(path.join(dir, ".agent/BACKLOG.md"), SAMPLE_BACKLOG.replace("### AE-BL-002\n\n- **Priority:** HIGH\n- **Status:** open", "### AE-BL-002\n\n- **Priority:** HIGH\n- **Status:** done\n- **Completion evidence:** cycle `AE-2026-07-01-001`, PR #1, merge commit `1111111111111111111111111111111111111`"));
  const gen = spawnSync("node", ["scripts/autonomous-agent-context.js"], { cwd: dir, encoding: "utf8" });
  if (gen.status !== 0) throw new Error(`context generation failed:\n${gen.stdout}\n${gen.stderr}`);
  const context = JSON.parse(fs.readFileSync(path.join(dir, ".agent/generated/AGENT_CONTEXT.json"), "utf8"));
  if (!context.backlogStatus || !Array.isArray(context.backlogStatus.open) || !Array.isArray(context.backlogStatus.completed)) {
    throw new Error("generated context must include a structured backlogStatus.open/completed split");
  }
  if (context.backlogStatus.open.includes("AE-BL-002")) throw new Error("completed AE-BL-002 must not be listed as open/eligible in generated context");
  if (!context.backlogStatus.open.includes("AE-BL-001")) throw new Error("open AE-BL-001 must be listed as eligible in generated context");
  const completedEntry = context.backlogStatus.completed.find((item) => item.id === "AE-BL-002");
  if (!completedEntry || !completedEntry.evidence || !/PR #1/.test(completedEntry.evidence)) {
    throw new Error(`expected completed AE-BL-002 entry with completion evidence, got: ${JSON.stringify(completedEntry)}`);
  }
  const md = fs.readFileSync(path.join(dir, ".agent/generated/AGENT_CONTEXT.md"), "utf8");
  if (!/do NOT re-select/i.test(md)) throw new Error("generated markdown context must explicitly instruct not to re-select completed items");
  ok("generated context distinguishes open and completed backlog items with completion evidence");
}

// 10. Invalid or contradictory lifecycle state fails closed.
{
  // 10a. Merged branch name's implied cycle_id does not match the decision artifact's cycle_id.
  {
    const dir = makeRepo();
    writeJson(path.join(dir, ".agent/runtime/current-decision.json"), decisionFixture({ cycle_id: "AE-2026-07-19-003", selected_backlog_id: "AE-BL-001" }));
    writeJson(path.join(dir, ".agent/runtime/runtime-result.json"), { cycle_id: "AE-2026-07-19-003", outcome: "success", changed_files: ["frontend/src/App.js"] });
    const reconcile = require(path.join(dir, "scripts/agent-backlog-reconcile.js"));
    const cwdBefore = process.cwd();
    process.chdir(dir);
    let threw = null;
    try { reconcile.reconcile("1", "3".repeat(40), "agent/AE-2026-07-19-999"); } catch (error) { threw = error; } finally { process.chdir(cwdBefore); }
    if (!threw || !/contradictory/.test(threw.message)) throw new Error(`expected cycle_id/head_branch mismatch to fail closed, got: ${threw && threw.message}`);
    ok("reconciliation fails closed on a cycle_id/head_branch mismatch");
  }
  // 10b. selected_backlog_id does not exist in .agent/BACKLOG.md.
  {
    const dir = makeRepo();
    writeJson(path.join(dir, ".agent/runtime/current-decision.json"), decisionFixture({ cycle_id: "AE-2026-07-19-004", selected_backlog_id: "AE-BL-999" }));
    writeJson(path.join(dir, ".agent/runtime/runtime-result.json"), { cycle_id: "AE-2026-07-19-004", outcome: "success", changed_files: ["frontend/src/App.js"] });
    const reconcile = require(path.join(dir, "scripts/agent-backlog-reconcile.js"));
    const cwdBefore = process.cwd();
    process.chdir(dir);
    let threw = null;
    try { reconcile.reconcile("2", "4".repeat(40), "agent/AE-2026-07-19-004"); } catch (error) { threw = error; } finally { process.chdir(cwdBefore); }
    if (!threw || !/does not exist in \.agent\/BACKLOG\.md/.test(threw.message)) throw new Error(`expected unknown backlog id to fail closed, got: ${threw && threw.message}`);
    ok("reconciliation fails closed on an unknown selected_backlog_id");
  }
  // 10c. Backlog item is recorded as rejected, but the cycle merged successfully -- contradictory state.
  {
    const dir = makeRepo();
    writeJson(path.join(dir, ".agent/runtime/current-decision.json"), decisionFixture({ cycle_id: "AE-2026-07-19-005", selected_backlog_id: "AE-BL-003" }));
    writeJson(path.join(dir, ".agent/runtime/runtime-result.json"), { cycle_id: "AE-2026-07-19-005", outcome: "success", changed_files: ["frontend/src/App.js"] });
    const reconcile = require(path.join(dir, "scripts/agent-backlog-reconcile.js"));
    const cwdBefore = process.cwd();
    process.chdir(dir);
    let threw = null;
    try { reconcile.reconcile("3", "5".repeat(40), "agent/AE-2026-07-19-005"); } catch (error) { threw = error; } finally { process.chdir(cwdBefore); }
    if (!threw || !/rejected/.test(threw.message)) throw new Error(`expected a rejected backlog item merging as success to fail closed, got: ${threw && threw.message}`);
    ok("reconciliation fails closed when a rejected backlog item's cycle nonetheless merged (contradictory state)");
  }
  // 10d. An implementation delta that edits .agent/BACKLOG.md to flip a status to done directly is rejected
  //      by the Diff Gate, even though BACKLOG.md is otherwise permitted agent state.
  {
    const dir = makeRepo();
    recordBase(dir);
    writeDecision(dir, { selected_backlog_id: "AE-BL-001", allowed_paths: ["frontend/src/App.js"] });
    writeFile(path.join(dir, "frontend/src/App.js"), "changed\n");
    writeFile(path.join(dir, ".agent/BACKLOG.md"), SAMPLE_BACKLOG.replace("### AE-BL-001\n\n- **Priority:** HIGH\n- **Status:** open", "### AE-BL-001\n\n- **Priority:** HIGH\n- **Status:** done"));
    const gate = diffGate(dir);
    if (gate.status === 0) throw new Error(`expected Diff Gate to reject an implementation delta that marks a backlog item done directly:\n${gate.stdout}`);
    if (!/only the deterministic post-merge reconciliation script may record backlog completion/.test(gate.stderr)) {
      throw new Error(`expected a clear backlog-tampering diagnostic, got:\n${gate.stderr}`);
    }
    ok("Diff Gate fails closed when an implementation delta marks a backlog item done directly");
  }
}

console.log("All Phase 2K backlog lifecycle regression scenarios passed.");
