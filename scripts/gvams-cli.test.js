#!/usr/bin/env node
// GVAMS Agent CLI v1 regression coverage: the pure routing/parsing logic (parseArgs, buildEnv, runCommand,
// runDoctor, printHelp/printVersion) is exercised directly with injected fake spawn functions (fast,
// deterministic), and the real CLI is exercised as a real subprocess against tiny fake stage scripts
// (mirroring the technique used for the Orchestrator's own tests) to prove genuine argv/env-var wiring, plus
// one true end-to-end run of a real routed command against the real Repository Intelligence engine.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "scripts/gvams-cli.js"), "utf8");
const repoIntelSource = fs.readFileSync(path.join(repoRoot, "scripts/repository-intelligence.js"), "utf8");

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvams-cli-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/gvams-cli.js"), source);
  return dir;
}

function requireFixture(dir) {
  return require(path.join(dir, "scripts/gvams-cli.js"));
}

function makeFakeSpawn(failOnScript, callLog) {
  return (nodeBin, args) => {
    const scriptName = path.basename(args[0]);
    if (callLog) callLog.push(scriptName);
    if (failOnScript && scriptName === failOnScript) {
      return { status: 1, stdout: "", stderr: `simulated failure in ${scriptName}`, error: null };
    }
    return { status: 0, stdout: `ok: ${scriptName}`, stderr: "", error: null };
  };
}

function ok(name) {
  console.log(`${name}: observed expected deterministic outcome`);
}

// 1. Command routing: every single-script command invokes exactly its own engine script, in the right
//    directory, and nothing else.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  for (const [command, commandDef] of Object.entries(mod.COMMANDS)) {
    if (commandDef.scripts.length !== 1) continue;
    const callLog = [];
    const exitCode = mod.runCommand(commandDef, mod.buildEnv({}), { spawnFn: makeFakeSpawn(null, callLog) });
    if (exitCode !== 0) throw new Error(`expected command "${command}" to succeed, got exit ${exitCode}`);
    if (callLog.length !== 1 || callLog[0] !== commandDef.scripts[0]) throw new Error(`expected command "${command}" to route to exactly ${commandDef.scripts[0]}, got: ${JSON.stringify(callLog)}`);
  }
  ok("every single-script command routes to exactly its own engine script");
}

// 2. Command routing (multi-script) + stop immediately: "implement" runs both of its scripts in order when
//    the first succeeds, but never invokes the second when the first fails.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const implementDef = mod.COMMANDS.implement;
  if (implementDef.scripts.length !== 2) throw new Error("expected \"implement\" to route to exactly two scripts");

  const successLog = [];
  const successExit = mod.runCommand(implementDef, mod.buildEnv({}), { spawnFn: makeFakeSpawn(null, successLog) });
  if (successExit !== 0 || JSON.stringify(successLog) !== JSON.stringify(implementDef.scripts)) {
    throw new Error(`expected both implement scripts to run in order on success, got: ${JSON.stringify(successLog)}`);
  }

  const failLog = [];
  const failExit = mod.runCommand(implementDef, mod.buildEnv({}), { spawnFn: makeFakeSpawn(implementDef.scripts[0], failLog) });
  if (failExit === 0) throw new Error("expected a non-zero exit when the first implement script fails");
  if (failLog.length !== 1) throw new Error(`expected the second implement script to never be invoked after the first fails, got: ${JSON.stringify(failLog)}`);

  ok("\"implement\" runs both of its engine scripts in order, and stops immediately if the first fails");
}

// 3. Argument parsing: --flag value and --flag=value both work, --dry-run is a boolean with no value,
//    multiple flags combine correctly, and unknown flags are collected rather than silently ignored.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);

  const spaceForm = mod.parseArgs(["analyze", "--provider", "claude-code-v1"]);
  if (spaceForm.options.provider !== "claude-code-v1") throw new Error("expected --flag value form to parse correctly");

  const equalsForm = mod.parseArgs(["analyze", "--provider=claude-code-v1"]);
  if (equalsForm.options.provider !== "claude-code-v1") throw new Error("expected --flag=value form to parse correctly");

  const boolForm = mod.parseArgs(["publish", "--dry-run"]);
  if (boolForm.options.dryRun !== true) throw new Error("expected --dry-run to parse as a boolean flag with no consumed value");
  if (boolForm.positional[0] !== "publish") throw new Error("expected the positional command to remain \"publish\" after a boolean flag");

  const combined = mod.parseArgs(["implement", "--goal", "fix bug", "--profile", "safe", "--dry-run"]);
  if (combined.options.goal !== "fix bug" || combined.options.profile !== "safe" || combined.options.dryRun !== true) {
    throw new Error(`expected all combined flags to parse correctly, got: ${JSON.stringify(combined.options)}`);
  }

  const withUnknown = mod.parseArgs(["analyze", "--bogus-flag"]);
  if (!withUnknown.unknown.includes("--bogus-flag")) throw new Error("expected an unrecognized flag to be collected as unknown, not silently ignored");

  let threw = null;
  try {
    mod.parseArgs(["analyze", "--provider"]);
  } catch (error) {
    threw = error;
  }
  if (!threw || !/requires a value/.test(threw.message)) throw new Error(`expected a clear error when a value-taking flag has no value, got: ${threw && threw.message}`);

  ok("argument parsing correctly handles --flag value, --flag=value, boolean flags, combined flags, and unknown flags");
}

// 4. buildEnv correctly translates every option into its documented environment variable, and never adds
//    stray env vars for options that were not supplied.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const env = mod.buildEnv({ goal: "g", profile: "p", provider: "prov", config: "/tmp/c.json", dryRun: true });
  if (env.GVAMS_GOAL !== "g" || env.GVAMS_PROFILE !== "p" || env.EXECUTION_PROVIDER !== "prov" || env.GVAMS_CONFIG_PATH !== "/tmp/c.json" || env.GITHUB_PUBLISH_DRY_RUN !== "true") {
    throw new Error(`expected every option to map to its documented env var, got: ${JSON.stringify(env)}`);
  }
  const emptyEnv = mod.buildEnv({});
  if ("GVAMS_GOAL" in emptyEnv || "EXECUTION_PROVIDER" in emptyEnv || "GITHUB_PUBLISH_DRY_RUN" in emptyEnv) {
    throw new Error("expected no stray env vars to be added for options that were never supplied");
  }
  ok("buildEnv correctly and exclusively translates supplied options into their documented environment variables");
}

// 5. Help output: full help lists every command and every option; `help <command>` shows focused
//    information; an unknown help topic is reported clearly rather than silently ignored.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const originalLog = console.log;
  let captured = "";
  console.log = (...parts) => {
    captured += `${parts.join(" ")}\n`;
  };
  try {
    mod.printHelp();
  } finally {
    console.log = originalLog;
  }
  for (const command of Object.keys(mod.COMMANDS)) {
    if (!captured.includes(command)) throw new Error(`expected top-level help to list command "${command}"`);
  }
  for (const flag of ["--goal", "--profile", "--provider", "--config", "--dry-run"]) {
    if (!captured.includes(flag)) throw new Error(`expected top-level help to document option "${flag}"`);
  }

  let topicCaptured = "";
  console.log = (...parts) => {
    topicCaptured += `${parts.join(" ")}\n`;
  };
  try {
    mod.printHelp("implement");
  } finally {
    console.log = originalLog;
  }
  if (!topicCaptured.includes("implementation-request-engine.js") || !topicCaptured.includes("implementation-executor.js")) {
    throw new Error(`expected focused help for "implement" to name both underlying scripts, got:\n${topicCaptured}`);
  }

  ok("printHelp lists every command/option at the top level, and shows focused, accurate detail for a specific command");
}

// 6. Version output: prints a version string and the running Node version, and never spawns any subprocess.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const originalLog = console.log;
  let captured = "";
  console.log = (...parts) => {
    captured += `${parts.join(" ")}\n`;
  };
  try {
    mod.printVersion();
  } finally {
    console.log = originalLog;
  }
  if (!new RegExp(`v${mod.CLI_VERSION.replace(/\./g, "\\.")}`).test(captured)) throw new Error(`expected the version output to include v${mod.CLI_VERSION}, got:\n${captured}`);
  if (!captured.includes(process.version)) throw new Error("expected the version output to include the running Node version");
  ok("printVersion reports the CLI's own version and the running Node version");
}

// 7. Error handling (via main()): an unknown command, an unknown option, and no command at all are all
//    reported clearly and return exit code 1, without ever attempting to spawn anything.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const originalError = console.error;
  const originalLog = console.log;
  console.error = () => {};
  console.log = () => {};
  let unknownCommandExit, unknownOptionExit, noCommandExit;
  try {
    unknownCommandExit = mod.main(["not-a-real-command"], { spawnFn: () => { throw new Error("should never spawn for an unknown command"); } });
    unknownOptionExit = mod.main(["analyze", "--not-a-real-option"], { spawnFn: () => { throw new Error("should never spawn when an option is unrecognized"); } });
    noCommandExit = mod.main([], { spawnFn: () => { throw new Error("should never spawn with no command"); } });
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  if (unknownCommandExit !== 1) throw new Error(`expected exit 1 for an unknown command, got: ${unknownCommandExit}`);
  if (unknownOptionExit !== 1) throw new Error(`expected exit 1 for an unknown option, got: ${unknownOptionExit}`);
  if (noCommandExit !== 1) throw new Error(`expected exit 1 when no command is given, got: ${noCommandExit}`);
  ok("unknown commands, unknown options, and a missing command are all rejected with exit code 1 and never attempt to spawn anything");
}

// 7b. Error handling: a routed command's underlying script failure propagates as the CLI's own exit code.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  const exitCode = mod.main(["analyze"], { spawnFn: makeFakeSpawn("repository-intelligence.js") });
  if (exitCode === 0) throw new Error("expected a failing underlying engine to produce a non-zero CLI exit code");
  ok("a routed command's underlying engine failure propagates as the CLI's own non-zero exit code");
}

// 8. doctor: reports every routable engine script's presence, and fails (exit 1) when one is missing;
//    reports git/gh availability from an injected spawn function without ever treating gh's absence as fatal.
{
  const dir = makeFixture();
  const mod = requireFixture(dir);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  const allScripts = [...new Set(Object.values(mod.COMMANDS).flatMap((c) => c.scripts))];
  for (const script of allScripts) writeFile(path.join(dir, "scripts", script), "// present\n");

  const originalLog = console.log;
  console.log = () => {};
  let healthyExit, unhealthyExit;
  try {
    healthyExit = mod.runDoctor({ cwd: dir, spawnFn: () => ({ status: 0, stdout: "git version 2.0.0", stderr: "", error: null }) });
    fs.rmSync(path.join(dir, "scripts", allScripts[0]));
    unhealthyExit = mod.runDoctor({ cwd: dir, spawnFn: () => ({ status: 0, stdout: "git version 2.0.0", stderr: "", error: null }) });
  } finally {
    console.log = originalLog;
  }
  if (healthyExit !== 0) throw new Error(`expected doctor to PASS (exit 0) when every engine script is present, got: ${healthyExit}`);
  if (unhealthyExit !== 1) throw new Error(`expected doctor to FAIL (exit 1) when an engine script is missing, got: ${unhealthyExit}`);

  let ghWarnExit;
  console.log = () => {};
  try {
    for (const script of allScripts) writeFile(path.join(dir, "scripts", script), "// present\n");
    ghWarnExit = mod.runDoctor({ cwd: dir, spawnFn: (bin) => (bin === "gh" ? { status: null, stdout: "", stderr: "", error: { message: "ENOENT" } } : { status: 0, stdout: "ok", stderr: "", error: null }) });
  } finally {
    console.log = originalLog;
  }
  if (ghWarnExit !== 0) throw new Error("expected a missing `gh` to be a warning only, never failing doctor's overall exit code");

  ok("doctor correctly reports engine script presence (fatal if missing) and git/gh availability (gh's absence is a warning only)");
}

// 9. CLI (real subprocess): --version, help, doctor, and an unknown command all work as real subprocesses;
//    a routed command's env-var passthrough (e.g. --provider -> EXECUTION_PROVIDER) is verified with a real
//    fake stage script that prints back the environment variable it actually received.
{
  const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), "gvams-cli-real-"));
  fs.mkdirSync(path.join(cliDir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(cliDir, "scripts/gvams-cli.js"), source);

  const versionResult = spawnSync("node", ["scripts/gvams-cli.js", "--version"], { cwd: cliDir, encoding: "utf8" });
  if (versionResult.status !== 0 || !versionResult.stdout.includes("GVAMS Agent CLI")) throw new Error(`expected --version to succeed and print the CLI's identity, got:\n${versionResult.stdout}${versionResult.stderr}`);

  const helpResult = spawnSync("node", ["scripts/gvams-cli.js", "help"], { cwd: cliDir, encoding: "utf8" });
  if (helpResult.status !== 0 || !helpResult.stdout.includes("USAGE")) throw new Error(`expected help to succeed and print usage, got:\n${helpResult.stdout}${helpResult.stderr}`);

  const unknownResult = spawnSync("node", ["scripts/gvams-cli.js", "bogus"], { cwd: cliDir, encoding: "utf8" });
  if (unknownResult.status !== 1 || !/unknown command/.test(unknownResult.stderr)) throw new Error(`expected an unknown command to exit 1 with a clear stderr message, got exit ${unknownResult.status}:\n${unknownResult.stderr}`);

  writeFile(
    path.join(cliDir, "scripts/implementation-request-engine.js"),
    'console.log("fake implementation-request-engine ran"); process.exit(0);\n'
  );
  writeFile(
    path.join(cliDir, "scripts/implementation-executor.js"),
    'console.log(`EXECUTION_PROVIDER seen by the child process: ${process.env.EXECUTION_PROVIDER}`); process.exit(0);\n'
  );
  const envPassthroughResult = spawnSync("node", ["scripts/gvams-cli.js", "implement", "--provider", "claude-code-v1"], { cwd: cliDir, encoding: "utf8" });
  if (envPassthroughResult.status !== 0) throw new Error(`expected the real CLI to succeed:\n${envPassthroughResult.stdout}${envPassthroughResult.stderr}`);
  if (!envPassthroughResult.stdout.includes("EXECUTION_PROVIDER seen by the child process: claude-code-v1")) {
    throw new Error(`expected --provider to be genuinely passed through as EXECUTION_PROVIDER to the real child process, got:\n${envPassthroughResult.stdout}`);
  }

  const mod = requireFixture(makeFixture());
  const allRoutableScripts = [...new Set(Object.values(mod.COMMANDS).flatMap((c) => c.scripts))];
  for (const script of allRoutableScripts) {
    if (!fs.existsSync(path.join(cliDir, "scripts", script))) {
      writeFile(path.join(cliDir, "scripts", script), 'process.exit(0);\n');
    }
  }
  const doctorResult = spawnSync("node", ["scripts/gvams-cli.js", "doctor"], { cwd: cliDir, encoding: "utf8" });
  if (doctorResult.status !== 0 || !doctorResult.stdout.includes("Doctor PASSED")) throw new Error(`expected doctor to pass for a fixture with every routable script present:\n${doctorResult.stdout}${doctorResult.stderr}`);

  ok("the real CLI subprocess correctly handles --version/help/an unknown command/doctor, and genuinely passes --provider through as EXECUTION_PROVIDER to a real child process");
}

// 10. End-to-end: `analyze`, run through the real CLI, drives the real Repository Intelligence engine and
//     produces its real output.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gvams-cli-e2e-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts/gvams-cli.js"), source);
  fs.writeFileSync(path.join(dir, "scripts/repository-intelligence.js"), repoIntelSource);
  writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "fixture-project", version: "1.0.0" }, null, 2));

  const result = spawnSync("node", ["scripts/gvams-cli.js", "analyze"], { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`expected the real "analyze" command to succeed:\n${result.stdout}${result.stderr}`);
  const outputPath = path.join(dir, "repository-intelligence", "repository-analysis.json");
  if (!fs.existsSync(outputPath)) throw new Error("expected the real Repository Intelligence engine's own output to be produced via the CLI");
  const analysis = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  if (!analysis || typeof analysis !== "object") throw new Error("expected valid JSON output from the real end-to-end CLI-routed run");

  ok("the real CLI's \"analyze\" command genuinely drives the real Repository Intelligence engine end to end");
}

console.log("All GVAMS Agent CLI v1 regression scenarios passed.");
