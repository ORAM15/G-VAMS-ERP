#!/usr/bin/env node
// GVAMS Agent CLI v1
//
// The public interface of the G-VAMS Autonomous Engineering System. This file contains NO engineering
// logic of its own -- it only parses a subcommand and a small set of global options, translates those
// options into the exact environment variables the existing, frozen engines already read, and spawns the
// right engine script(s) in order, exactly as their own CLIs already work. Every decision about what a
// recommendation is, whether an execution succeeded, or whether a change is approved remains entirely owned
// by the engine that already owns it -- this file never re-implements or second-guesses any of that.
//
// Run with:   node scripts/gvams-cli.js <command> [options]
// Run `node scripts/gvams-cli.js help` for the full command/option reference.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const CLI_VERSION = "1.0.0";

// Command -> the existing engine script(s) it routes to, run in order (stopping immediately if one fails).
// "implement" is the one command that spans two engines -- generating the implementation request and then
// executing it are two separate frozen engines, but from a CLI user's point of view "implement" is one
// verb, exactly as `git commit` is one verb even though a hook can run first.
const COMMANDS = {
  analyze: { scripts: ["repository-intelligence.js"], description: "Run Repository Intelligence." },
  knowledge: { scripts: ["engineering-knowledge.js"], description: "Run Engineering Knowledge Engine." },
  recommend: { scripts: ["recommendation-engine.js"], description: "Run Recommendation Engine." },
  decide: { scripts: ["adaptive-decision-engine.js"], description: "Run Adaptive Decision Engine v2." },
  implement: { scripts: ["implementation-request-engine.js", "implementation-executor.js"], description: "Generate an implementation request, then execute it." },
  validate: { scripts: ["validation-engine.js"], description: "Run Validation Engine." },
  pr: { scripts: ["pull-request-generator.js"], description: "Run Pull Request Generator." },
  publish: { scripts: ["github-publisher.js"], description: "Run GitHub Publisher Adapter." },
  autonomous: { scripts: ["autonomous-orchestrator.js"], description: "Run the full nine-stage pipeline end to end." },
};

// Global option -> {key on the parsed options object, whether it takes a value}. Every option is translated
// 1:1 into an environment variable in buildEnv() below -- see that function's comments for exactly which
// env var each one becomes and whether any current engine actually reads it yet.
const GLOBAL_FLAGS = {
  "--goal": { key: "goal", takesValue: true },
  "--profile": { key: "profile", takesValue: true },
  "--provider": { key: "provider", takesValue: true },
  "--config": { key: "config", takesValue: true },
  "--dry-run": { key: "dryRun", takesValue: false },
  "--help": { key: "help", takesValue: false },
  "-h": { key: "help", takesValue: false },
  "--version": { key: "version", takesValue: false },
};

/**
 * Parses argv into a subcommand (and any command-topic argument, e.g. `help <command>`) plus the five
 * global options. Supports both `--flag value` and `--flag=value` forms, and `--` to stop flag parsing.
 * Unrecognized `--flags` are collected (never silently ignored) so the caller can fail closed on them.
 * @param {string[]} argv arguments after the node binary and script path (i.e. process.argv.slice(2))
 * @returns {{positional: string[], options: object, unknown: string[]}}
 */
function parseArgs(argv) {
  const args = [...argv];
  const positional = [];
  const options = {};
  const unknown = [];

  while (args.length > 0) {
    const token = args.shift();
    if (token === "--") {
      positional.push(...args);
      break;
    }
    if (token.startsWith("-")) {
      const eqIndex = token.indexOf("=");
      const name = eqIndex === -1 ? token : token.slice(0, eqIndex);
      const inlineValue = eqIndex === -1 ? null : token.slice(eqIndex + 1);
      const flagDef = GLOBAL_FLAGS[name];
      if (!flagDef) {
        unknown.push(name);
        continue;
      }
      if (flagDef.takesValue) {
        const value = inlineValue !== null ? inlineValue : args.shift();
        if (value === undefined) throw new Error(`${name} requires a value.`);
        options[flagDef.key] = value;
      } else {
        options[flagDef.key] = true;
      }
    } else {
      positional.push(token);
    }
  }

  return { positional, options, unknown };
}

/**
 * Translates parsed global options into environment variable overrides for the spawned engine(s). This is
 * the ONLY place any option's meaning is decided, and it decides nothing beyond "which existing env var
 * does this become" -- no filtering, no validation of business content, no engineering logic.
 *   --provider  -> EXECUTION_PROVIDER      (real: read by implementation-executor.js today)
 *   --dry-run   -> GITHUB_PUBLISH_DRY_RUN=true (real: read by github-publisher.js today; already its default)
 *   --goal      -> GVAMS_GOAL              (reserved: no current engine reads this yet)
 *   --profile   -> GVAMS_PROFILE           (reserved: no current engine reads this yet)
 *   --config    -> GVAMS_CONFIG_PATH       (reserved: no current engine reads this yet)
 * @param {object} options result of parseArgs().options
 * @returns {object} a full environment object (process.env plus the above overrides) for the child process
 */
function buildEnv(options) {
  const env = { ...process.env };
  if (options.goal !== undefined) env.GVAMS_GOAL = options.goal;
  if (options.profile !== undefined) env.GVAMS_PROFILE = options.profile;
  if (options.provider !== undefined) env.EXECUTION_PROVIDER = options.provider;
  if (options.config !== undefined) env.GVAMS_CONFIG_PATH = options.config;
  if (options.dryRun) env.GITHUB_PUBLISH_DRY_RUN = "true";
  return env;
}

/**
 * Runs a command's engine script(s) in order, exactly as `node scripts/<script>.js` would run them
 * directly, stopping immediately the moment one exits non-zero (later scripts, if any, are never invoked).
 * @param {{scripts: string[]}} commandDef
 * @param {object} env environment to run the child process(es) with (see buildEnv())
 * @param {{spawnFn?: Function, nodeBin?: string, cwd?: string, stdio?: (string|string[])}} [deps]
 * @returns {number} the exit code the CLI itself should exit with
 */
function runCommand(commandDef, env, deps) {
  const spawnFn = (deps && deps.spawnFn) || spawnSync;
  const nodeBin = (deps && deps.nodeBin) || process.execPath;
  const cwd = (deps && deps.cwd) || root;
  const stdio = (deps && deps.stdio) || "inherit";

  for (const script of commandDef.scripts) {
    const scriptPath = path.join(cwd, "scripts", script);
    const result = spawnFn(nodeBin, [scriptPath], { cwd, env, encoding: "utf8", stdio });
    if (result && result.error) {
      console.error(`ERROR: failed to launch scripts/${script}: ${result.error.message}`);
      return 1;
    }
    const exitCode = result ? result.status : null;
    if (exitCode !== 0) return exitCode === null ? 1 : exitCode;
  }
  return 0;
}

/**
 * A read-only diagnostic: checks that every engine script this CLI can route to actually exists on disk,
 * and reports whether `git`/`gh` are resolvable (informational only -- their absence only affects real,
 * non-dry-run publishing, so it is a warning, not a failure). Never inspects the repository's own business
 * content, never invokes AI.
 * @param {{spawnFn?: Function, cwd?: string}} [deps]
 * @returns {number} 0 if every engine script is present, 1 otherwise
 */
function runDoctor(deps) {
  const spawnFn = (deps && deps.spawnFn) || spawnSync;
  const cwd = (deps && deps.cwd) || root;

  console.log(`GVAMS Agent CLI v${CLI_VERSION} doctor -- checking engines and tooling.\n`);

  let healthy = true;
  const allScripts = [...new Set(Object.values(COMMANDS).flatMap((commandDef) => commandDef.scripts))];
  for (const script of allScripts) {
    const exists = fs.existsSync(path.join(cwd, "scripts", script));
    console.log(`  [${exists ? "OK" : "MISSING"}] scripts/${script}`);
    if (!exists) healthy = false;
  }

  for (const [bin, label] of [
    ["git", "git"],
    ["gh", "GitHub CLI (gh)"],
  ]) {
    const result = spawnFn(bin, ["--version"], { encoding: "utf8" });
    const available = Boolean(result && !result.error && result.status === 0);
    console.log(`  [${available ? "OK" : "WARN"}] ${label} ${available ? "available" : "not available (only affects real, non-dry-run publishing)"}`);
  }

  console.log(`\nNode: ${process.version}`);
  console.log(`\nDoctor ${healthy ? "PASSED" : "FAILED"}.`);
  return healthy ? 0 : 1;
}

function printVersion() {
  console.log(`GVAMS Agent CLI v${CLI_VERSION}`);
  console.log(`Node ${process.version}`);
}

/**
 * Prints top-level help (professional-CLI style: usage, commands, options, examples), or focused help for
 * one command when a topic is given.
 * @param {string} [topic] a command name, or undefined for the full reference
 */
function printHelp(topic) {
  if (topic && COMMANDS[topic]) {
    const commandDef = COMMANDS[topic];
    console.log(`gvams ${topic} -- ${commandDef.description}`);
    console.log("");
    console.log("Runs:");
    commandDef.scripts.forEach((script) => console.log(`  node scripts/${script}`));
    return;
  }
  if (topic) {
    console.log(`No help topic "${topic}". Run \`node scripts/gvams-cli.js help\` for the full list of commands.`);
    return;
  }

  console.log(`GVAMS Agent CLI v${CLI_VERSION}`);
  console.log("The public interface of the G-VAMS Autonomous Engineering System.");
  console.log("");
  console.log("USAGE");
  console.log("  node scripts/gvams-cli.js <command> [options]");
  console.log("");
  console.log("COMMANDS");
  Object.entries(COMMANDS).forEach(([name, commandDef]) => console.log(`  ${name.padEnd(12)} ${commandDef.description}`));
  console.log(`  ${"doctor".padEnd(12)} Check that required engines and tools are present.`);
  console.log(`  ${"version".padEnd(12)} Print the CLI version.`);
  console.log(`  ${"help".padEnd(12)} Show this help, or \`help <command>\` for help on one command.`);
  console.log("");
  console.log("OPTIONS");
  console.log("  --goal <text>       Passed through as GVAMS_GOAL. (reserved -- no current engine reads it yet)");
  console.log("  --profile <name>    Passed through as GVAMS_PROFILE. (reserved -- no current engine reads it yet)");
  console.log("  --provider <name>   Passed through as EXECUTION_PROVIDER (used by `implement`'s executor stage).");
  console.log("  --config <path>     Passed through as GVAMS_CONFIG_PATH. (reserved -- no current engine reads it yet)");
  console.log("  --dry-run           Passed through as GITHUB_PUBLISH_DRY_RUN=true (used by `publish`/`autonomous`; already the default).");
  console.log("  -h, --help          Show help.");
  console.log("  --version           Print the CLI version.");
  console.log("");
  console.log("EXAMPLES");
  console.log("  node scripts/gvams-cli.js analyze");
  console.log("  node scripts/gvams-cli.js implement --provider claude-code-v1");
  console.log("  node scripts/gvams-cli.js publish --dry-run");
  console.log("  node scripts/gvams-cli.js autonomous");
  console.log("  node scripts/gvams-cli.js doctor");
}

/**
 * The CLI's single entry point: parses argv, dispatches to help/version/doctor or routes to an engine
 * command, and returns the process exit code. Never throws for ordinary usage errors (unknown command,
 * unknown option, missing value) -- those are reported cleanly and returned as exit code 1, matching
 * professional CLI conventions (git/gh/docker/npm).
 * @param {string[]} argv arguments after the node binary and script path
 * @param {object} [deps] injectable dependencies, passed through to runCommand()/runDoctor()
 * @returns {number} process exit code
 */
function main(argv, deps) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return 1;
  }
  const { positional, options, unknown } = parsed;

  if (unknown.length > 0) {
    console.error(`ERROR: unknown option(s): ${unknown.join(", ")}`);
    console.error("Run `node scripts/gvams-cli.js help` for usage.");
    return 1;
  }

  if (options.version) {
    printVersion();
    return 0;
  }

  const command = positional[0];

  if (options.help) {
    printHelp(command);
    return 0;
  }
  if (!command) {
    printHelp();
    return 1;
  }
  if (command === "help") {
    printHelp(positional[1]);
    return 0;
  }
  if (command === "version") {
    printVersion();
    return 0;
  }
  if (command === "doctor") {
    return runDoctor(deps);
  }

  const commandDef = COMMANDS[command];
  if (!commandDef) {
    console.error(`ERROR: unknown command "${command}".`);
    console.error("Run `node scripts/gvams-cli.js help` for a list of commands.");
    return 1;
  }

  const env = buildEnv(options);
  return runCommand(commandDef, env, deps);
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  root,
  CLI_VERSION,
  COMMANDS,
  GLOBAL_FLAGS,
  parseArgs,
  buildEnv,
  runCommand,
  runDoctor,
  printVersion,
  printHelp,
  main,
};
