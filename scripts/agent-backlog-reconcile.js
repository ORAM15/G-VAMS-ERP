#!/usr/bin/env node
// Deterministic, LLM-free post-merge backlog completion reconciliation.
//
// Usage: node scripts/agent-backlog-reconcile.js <pr_number> <merge_commit_sha> <head_branch>
//
// Run only after a human has merged an autonomous implementation PR into main (see
// .github/workflows/agent-backlog-reconcile.yml). It reads the already-merged, human-reviewed
// .agent/runtime/current-decision.json and .agent/runtime/runtime-result.json evidence sitting in the
// checked-out tree, cross-checks it against the merged branch name, and -- only if every check passes --
// flips exactly the one referenced backlog item's Status to `done` in .agent/BACKLOG.md, with an auditable
// completion-evidence line. This is the single trusted place backlog completion is ever recorded; nothing
// during the implementation/Result Gate/branch-publication stages may do this (see
// scripts/agent-gatekeeper.js backlogCompletionTampering(), enforced by the Diff Gate).
const fs = require("fs");
const path = require("path");
const gatekeeper = require("./agent-gatekeeper.js");

const root = path.resolve(__dirname, "..");
const decisionPath = path.join(root, ".agent", "runtime", "current-decision.json");
const resultPath = path.join(root, ".agent", "runtime", "runtime-result.json");
const backlogPath = path.join(root, ".agent", "BACKLOG.md");

function readJson(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing; refusing to reconcile without confirmed merge evidence`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function cycleIdFromHeadBranch(headBranch) {
  const match = headBranch.match(/^agent\/(.+)$/);
  if (!match) throw new Error(`merged head branch "${headBranch}" does not match the expected agent/<cycle_id> naming convention`);
  return match[1].replace(/-run-\d+-\d+$/, "");
}

function reconcile(prNumber, mergeCommitSha, headBranch) {
  if (!/^\d+$/.test(String(prNumber))) throw new Error(`invalid PR number: ${prNumber}`);
  if (!/^[0-9a-f]{40}$/.test(mergeCommitSha) && !/^[0-9a-f]{64}$/.test(mergeCommitSha)) throw new Error(`invalid merge commit SHA: ${mergeCommitSha}`);
  if (!headBranch) throw new Error("head branch is required");

  const decision = readJson(decisionPath, ".agent/runtime/current-decision.json");
  const result = readJson(resultPath, ".agent/runtime/runtime-result.json");

  const expectedCycleId = cycleIdFromHeadBranch(headBranch);
  if (decision.cycle_id !== expectedCycleId) {
    throw new Error(`merged branch "${headBranch}" implies cycle_id "${expectedCycleId}" but .agent/runtime/current-decision.json declares cycle_id "${decision.cycle_id}"; refusing to reconcile ambiguous/contradictory state`);
  }

  if (result.outcome !== "success") {
    console.log(`Cycle ${decision.cycle_id} outcome is "${result.outcome}", not "success"; nothing to reconcile.`);
    return { reconciled: false };
  }

  const backlogId = decision.selected_backlog_id;
  if (!backlogId) {
    console.log(`Cycle ${decision.cycle_id} was a repository-observed improvement with no selected_backlog_id; nothing to reconcile.`);
    return { reconciled: false };
  }

  const backlogText = fs.readFileSync(backlogPath, "utf8");
  const items = gatekeeper.parseBacklogItems(backlogText);
  const item = items.find((candidate) => candidate.id === backlogId);
  if (!item) {
    throw new Error(`decision references selected_backlog_id "${backlogId}" which does not exist in .agent/BACKLOG.md; refusing to fabricate a backlog entry`);
  }
  if (item.status === "done") {
    console.log(`Backlog item ${backlogId} is already recorded as done; reconciliation is idempotent, nothing to change.`);
    return { reconciled: false };
  }
  if (item.status === "rejected") {
    throw new Error(`backlog item ${backlogId} is recorded as "rejected" but cycle ${decision.cycle_id} (PR #${prNumber}) merged successfully; contradictory lifecycle state, refusing to guess`);
  }
  if (!item.status) {
    throw new Error(`backlog item ${backlogId} has no declared Status in .agent/BACKLOG.md; refusing to guess its prior lifecycle state`);
  }

  const block = backlogText.slice(item.start, item.end);
  // Trailing whitespace is deliberately restricted to spaces/tabs ([ \t]*), never \s*: \s also matches
  // newlines, which would otherwise let this greedily consume the blank line separating this item from the
  // next "### " heading (and get backtracked back only as far as the next $, silently swallowing it).
  const statusLineRe = /^-\s*\*\*Status:\*\*\s*\S+[ \t]*$/m;
  if (!statusLineRe.test(block)) throw new Error(`backlog item ${backlogId} block does not contain a parseable Status line; refusing to guess`);
  const evidenceLine = `- **Completion evidence:** cycle \`${decision.cycle_id}\`, PR #${prNumber}, merge commit \`${mergeCommitSha}\``;
  const updatedBlock = block.replace(statusLineRe, `- **Status:** done\n${evidenceLine}`);
  const updatedText = backlogText.slice(0, item.start) + updatedBlock + backlogText.slice(item.end);
  fs.writeFileSync(backlogPath, updatedText);
  console.log(`Reconciled backlog item ${backlogId} as done (cycle ${decision.cycle_id}, PR #${prNumber}, merge commit ${mergeCommitSha}).`);
  return { reconciled: true, backlogId, cycleId: decision.cycle_id };
}

if (require.main === module) {
  const [prNumber, mergeCommitSha, headBranch] = process.argv.slice(2);
  try {
    reconcile(prNumber, mergeCommitSha, headBranch);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}
module.exports = { reconcile, cycleIdFromHeadBranch };
