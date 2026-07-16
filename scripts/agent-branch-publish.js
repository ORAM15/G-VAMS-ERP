#!/usr/bin/env node
// Deterministic, collision-safe autonomous branch publication decision.
//
// Usage: node scripts/agent-branch-publish.js <cycle_id> <pending_tree_sha>
//
// Prints exactly one line to stdout: "<action> <branch>" where action is one of:
//   publish_new       - the normal agent/<cycle_id> branch does not exist on origin; use it as-is.
//   publish_collision - agent/<cycle_id> exists on origin with different history; a fresh,
//                        deterministic run-scoped branch name must be pushed instead.
//   reuse_existing     - the intended branch already exists on origin and its tree is byte-identical
//                        to the pending commit's tree; nothing new needs to be committed or pushed.
//
// This never decides to force-push or delete anything. Diagnostics go to stderr so stdout stays a
// single clean line the calling workflow step can parse.
const { execFileSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const remote = "origin";

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Fetches a single remote branch ref (if it exists) into a throwaway local namespace and returns its
// tree SHA, without creating or touching any locally-named branch. Returns null if the remote branch
// does not exist.
function remoteBranchTree(branch) {
  const probeRef = `refs/agent-branch-publish-probe/${branch}`;
  try {
    git(["fetch", "--quiet", remote, `+refs/heads/${branch}:${probeRef}`]);
  } catch {
    return null;
  }
  try {
    return git(["rev-parse", `${probeRef}^{tree}`]);
  } catch {
    return null;
  }
}

function isValidCycleId(cycleId) {
  return /^[A-Za-z0-9._:-]{3,}$/.test(cycleId);
}

function isValidTreeSha(sha) {
  return /^[0-9a-f]{40}$/.test(sha) || /^[0-9a-f]{64}$/.test(sha);
}

function main() {
  const [cycleId, pendingTree] = process.argv.slice(2);
  if (!cycleId || !isValidCycleId(cycleId)) throw new Error("a valid cycle_id argument is required");
  if (!pendingTree || !isValidTreeSha(pendingTree)) throw new Error("a valid pending tree SHA argument is required");

  const baseBranch = `agent/${cycleId}`;
  const baseTree = remoteBranchTree(baseBranch);

  if (baseTree === null) {
    console.error(`${remote}/${baseBranch} does not exist yet; publishing under the normal branch name.`);
    console.log(`publish_new ${baseBranch}`);
    return;
  }
  if (baseTree === pendingTree) {
    console.error(`${remote}/${baseBranch} already has tree ${pendingTree}, identical to this cycle's pending result; reusing it idempotently.`);
    console.log(`reuse_existing ${baseBranch}`);
    return;
  }

  const runId = process.env.GITHUB_RUN_ID;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
  if (!runId || !runAttempt) {
    throw new Error(`${remote}/${baseBranch} already exists with different history (tree ${baseTree} != ${pendingTree}) and no deterministic GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT is available to derive a collision-resistant branch name; refusing to force-push or guess`);
  }

  const collisionBranch = `${baseBranch}-run-${runId}-${runAttempt}`;
  const collisionTree = remoteBranchTree(collisionBranch);

  if (collisionTree === null) {
    console.error(`${remote}/${baseBranch} exists with different history (tree ${baseTree} != ${pendingTree}); publishing under collision-resistant name ${collisionBranch} instead.`);
    console.log(`publish_collision ${collisionBranch}`);
    return;
  }
  if (collisionTree === pendingTree) {
    console.error(`${remote}/${collisionBranch} already has tree ${pendingTree}, identical to this cycle's pending result (retry of the same run/attempt); reusing it idempotently.`);
    console.log(`reuse_existing ${collisionBranch}`);
    return;
  }
  throw new Error(`both ${remote}/${baseBranch} and the run-scoped ${remote}/${collisionBranch} already exist with history that does not match this cycle's pending result; refusing to force-push or guess a further name`);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
