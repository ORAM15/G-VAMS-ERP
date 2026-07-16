#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const scriptSource = fs.readFileSync(path.join(repoRoot, "scripts/agent-branch-publish.js"), "utf8");
// Normalized to LF for the regex-based static scans below; the file's own CRLF convention is untouched on
// disk (this is a read-only test-side copy).
const workflowSource = fs.readFileSync(path.join(repoRoot, ".github/workflows/autonomous-evolution.yml"), "utf8").replace(/\r\n/g, "\n");

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeBareRemote() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-branch-remote-"));
  run("git", ["init", "-q", "--bare"], dir);
  // Pin HEAD to refs/heads/main up front so clones of this bare remote check out the branch we actually
  // push, regardless of the host machine's init.defaultBranch configuration.
  run("git", ["symbolic-ref", "HEAD", "refs/heads/main"], dir);
  return dir;
}

function makeRepo(remoteDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-branch-publish-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/agent-branch-publish.js"), scriptSource);
  run("git", ["init", "-q"], dir);
  run("git", ["config", "user.email", "test@example.com"], dir);
  run("git", ["config", "user.name", "Test User"], dir);
  run("git", ["config", "core.autocrlf", "false"], dir);
  writeFile(path.join(dir, "README.md"), "base\n");
  run("git", ["add", "."], dir);
  run("git", ["commit", "-q", "-m", "base"], dir);
  run("git", ["remote", "add", "origin", remoteDir], dir);
  run("git", ["push", "-q", "origin", "HEAD:refs/heads/main"], dir);
  return dir;
}

// Simulates a prior run having already published `branchName` directly against the bare remote, from the
// same base commit, applying exactly one file write. Returns the resulting tree SHA.
function publishRemoteBranch(remoteDir, branchName, filePath, fileContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-branch-prior-"));
  // --config core.autocrlf=false is applied before the clone's initial checkout runs; setting it only
  // afterward is too late to stop that checkout from converting line endings on this host, which would
  // otherwise get silently re-staged by `git add -A` below as a spurious, non-deterministic tree diff.
  run("git", ["clone", "-q", "--config", "core.autocrlf=false", remoteDir, dir]);
  run("git", ["config", "user.email", "prior@example.com"], dir);
  run("git", ["config", "user.name", "Prior Run"], dir);
  run("git", ["switch", "-c", branchName], dir);
  writeFile(path.join(dir, filePath), fileContent);
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", "prior autonomous commit"], dir);
  run("git", ["push", "-q", "origin", branchName], dir);
  return run("git", ["rev-parse", "HEAD^{tree}"], dir);
}

function pendingTree(dir, filePath, fileContent) {
  writeFile(path.join(dir, filePath), fileContent);
  run("git", ["add", "-A"], dir);
  return run("git", ["write-tree"], dir);
}

function runScript(dir, cycleId, tree, env = {}) {
  return spawnSync("node", ["scripts/agent-branch-publish.js", cycleId, tree], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function parseDecision(stdout) {
  const line = stdout.trim().split("\n").filter(Boolean).pop() || "";
  const [action, branch] = line.split(" ");
  return { action, branch };
}

function expect(name, condition, detail) {
  if (!condition) throw new Error(`${name}: ${detail}`);
  console.log(`${name}: observed expected deterministic outcome`);
}

// 1. No remote branch exists -> normal cycle branch name is used.
{
  const remote = makeBareRemote();
  const dir = makeRepo(remote);
  const cycleId = "AE-2026-07-16-001";
  const tree = pendingTree(dir, "frontend/src/App.js", "changed\n");
  const result = runScript(dir, cycleId, tree);
  if (result.status !== 0) throw new Error(`no-remote-branch scenario failed:\n${result.stdout}\n${result.stderr}`);
  const { action, branch } = parseDecision(result.stdout);
  expect("no remote branch exists -> publish_new with normal name", action === "publish_new" && branch === `agent/${cycleId}`, `got action=${action} branch=${branch}`);
}

// 2. Remote branch name collision with different history -> collision-resistant branch name is selected.
{
  const remote = makeBareRemote();
  const dir = makeRepo(remote);
  const cycleId = "AE-2026-07-16-001";
  publishRemoteBranch(remote, `agent/${cycleId}`, "prior-only.txt", "prior-content-A\n");
  const tree = pendingTree(dir, "frontend/src/App.js", "different-change\n");
  const result = runScript(dir, cycleId, tree, { GITHUB_RUN_ID: "1111111111", GITHUB_RUN_ATTEMPT: "1" });
  if (result.status !== 0) throw new Error(`collision scenario failed:\n${result.stdout}\n${result.stderr}`);
  const { action, branch } = parseDecision(result.stdout);
  expect("collision with different history -> publish_collision with run-scoped name", action === "publish_collision" && branch === `agent/${cycleId}-run-1111111111-1`, `got action=${action} branch=${branch}`);
}

// 3. Existing branch already represents the exact intended commit (identical tree) -> safe/idempotent reuse.
{
  const remote = makeBareRemote();
  const dir = makeRepo(remote);
  const cycleId = "AE-2026-07-16-001";
  const filePath = "frontend/src/App.js";
  const content = "identical-change\n";
  publishRemoteBranch(remote, `agent/${cycleId}`, filePath, content);
  const tree = pendingTree(dir, filePath, content);
  const result = runScript(dir, cycleId, tree);
  if (result.status !== 0) throw new Error(`idempotent reuse scenario failed:\n${result.stdout}\n${result.stderr}`);
  const { action, branch } = parseDecision(result.stdout);
  expect("existing branch already represents exact commit -> reuse_existing", action === "reuse_existing" && branch === `agent/${cycleId}`, `got action=${action} branch=${branch}`);
}

// 3b. Retry of the same run/attempt after a collision was already published under the run-scoped name with
//     identical content -> reuse that run-scoped branch idempotently rather than failing.
{
  const remote = makeBareRemote();
  const dir = makeRepo(remote);
  const cycleId = "AE-2026-07-16-001";
  const filePath = "frontend/src/App.js";
  const content = "retry-content\n";
  publishRemoteBranch(remote, `agent/${cycleId}`, "prior-only.txt", "unrelated-prior\n");
  publishRemoteBranch(remote, `agent/${cycleId}-run-2222222222-1`, filePath, content);
  const tree = pendingTree(dir, filePath, content);
  const result = runScript(dir, cycleId, tree, { GITHUB_RUN_ID: "2222222222", GITHUB_RUN_ATTEMPT: "1" });
  if (result.status !== 0) throw new Error(`retry-of-same-attempt scenario failed:\n${result.stdout}\n${result.stderr}`);
  const { action, branch } = parseDecision(result.stdout);
  expect("retry of same run/attempt reuses matching run-scoped branch", action === "reuse_existing" && branch === `agent/${cycleId}-run-2222222222-1`, `got action=${action} branch=${branch}`);
}

// 3c. Both the base name and the run-scoped name exist with genuinely different, non-matching history ->
//     fail closed rather than guessing or force-pushing.
{
  const remote = makeBareRemote();
  const dir = makeRepo(remote);
  const cycleId = "AE-2026-07-16-001";
  publishRemoteBranch(remote, `agent/${cycleId}`, "prior-only.txt", "prior-content-A\n");
  publishRemoteBranch(remote, `agent/${cycleId}-run-3333333333-1`, "other-only.txt", "prior-content-B\n");
  const tree = pendingTree(dir, "frontend/src/App.js", "genuinely-new-change\n");
  const result = runScript(dir, cycleId, tree, { GITHUB_RUN_ID: "3333333333", GITHUB_RUN_ATTEMPT: "1" });
  expect("double collision with unmatched history fails closed", result.status !== 0 && /refusing to force-push or guess/.test(result.stderr), `expected non-zero exit and refusal message, got status=${result.status} stderr=${result.stderr}`);
}

// 4. No unconditional force-push is introduced anywhere in the new script or the Branch Commit step.
{
  if (scriptSource.includes("--force") || scriptSource.includes("force-with-lease")) {
    throw new Error("agent-branch-publish.js must never reference a force-push flag");
  }
  const branchCommitMatch = workflowSource.match(/- name: Branch Commit\n[\s\S]*?(?=\n {6}- name:)/);
  if (!branchCommitMatch) throw new Error("could not locate Branch Commit step in workflow for static scan");
  const branchCommitBlock = branchCommitMatch[0];
  if (branchCommitBlock.includes("--force") || branchCommitBlock.includes("force-with-lease")) {
    throw new Error("Branch Commit step must never force-push");
  }
  if (!/git push origin "\$BRANCH"/.test(branchCommitBlock)) {
    throw new Error("Branch Commit step must push the resolved $BRANCH without extra flags");
  }
  console.log("no unconditional force-push introduced: observed expected deterministic outcome");
}

// 5. PR creation receives the final branch name actually published (single, consistent AGENT_BRANCH export
//    used by every publication action, and PR Creation reads that same variable).
{
  const branchCommitMatch = workflowSource.match(/- name: Branch Commit\n[\s\S]*?(?=\n {6}- name:)/);
  const branchCommitBlock = branchCommitMatch[0];
  const exportCount = (branchCommitBlock.match(/AGENT_BRANCH=\$BRANCH/g) || []).length;
  if (exportCount !== 1) throw new Error(`expected exactly one AGENT_BRANCH export in Branch Commit (shared by every action), found ${exportCount}`);
  const prCreationMatch = workflowSource.match(/- name: PR Creation\n[\s\S]*?(?=\n {6}- name:)/);
  if (!prCreationMatch) throw new Error("could not locate PR Creation step in workflow for static scan");
  if (!/--head "\$AGENT_BRANCH"/.test(prCreationMatch[0])) {
    throw new Error("PR Creation step must use $AGENT_BRANCH as --head");
  }
  if (!/gh pr list --head "\$AGENT_BRANCH"/.test(prCreationMatch[0])) {
    throw new Error("PR Creation step must check for an existing PR on $AGENT_BRANCH before creating one, for idempotent reuse");
  }
  console.log("PR creation receives the final published branch name and is idempotent: observed expected deterministic outcome");
}

// Bonus: malformed input fails closed.
{
  const remote = makeBareRemote();
  const dir = makeRepo(remote);
  const tree = pendingTree(dir, "frontend/src/App.js", "changed\n");
  const badCycle = runScript(dir, "!!not-a-valid-cycle-id!!", tree);
  expect("invalid cycle_id fails closed", badCycle.status !== 0, `expected non-zero exit, got ${badCycle.status}`);
  const badTree = runScript(dir, "AE-2026-07-16-001", "not-a-tree-sha");
  expect("invalid tree SHA fails closed", badTree.status !== 0, `expected non-zero exit, got ${badTree.status}`);
}

console.log("All agent-branch-publish regression scenarios passed.");
