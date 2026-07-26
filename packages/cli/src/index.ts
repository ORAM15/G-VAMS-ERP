/**
 * ORAM CLI — command architecture only (this phase's Task 4). No command has real behavior yet; every one
 * of them exists now so the shape of `oram <command>` is fixed early, and so @oram/runtime / @oram/sdk have
 * a stable surface to be wired into later without the command list itself changing.
 *
 * Deliberately dependency-free (no commander/yargs) -- matching this repository's own established
 * convention (see scripts/gvams-cli.js's own parseArgs()/COMMANDS dispatch table) of a small, hand-rolled
 * dispatcher over adding a new dependency for something this simple. This mirrors gvams-cli.js's shape
 * closely on purpose: this package supersedes it (see this package's README.md), not reinvents its pattern.
 *
 * TODO(cli): once @oram/runtime exists in a usable form, each command module should accept an injected
 *   Runtime instance instead of constructing its own -- keeps commands testable without a real filesystem.
 * TODO(cli): add --help/--version handling per command, mirroring gvams-cli.js's printHelp()/printVersion().
 * TODO(cli): add a real `bin/oram` entry point once a build step exists (see package.json's `bin` field).
 */
import { initCommand } from "./commands/init";
import { runCommand } from "./commands/run";
import { analyzeCommand } from "./commands/analyze";
import { planCommand } from "./commands/plan";
import { executeCommand } from "./commands/execute";
import { validateCommand } from "./commands/validate";
import { inspectCommand } from "./commands/inspect";
import { dashboardCommand } from "./commands/dashboard";
import { doctorCommand } from "./commands/doctor";
import { replayCommand } from "./commands/replay";

export type CommandHandler = (args: string[]) => Promise<number>;

/** Command name -> handler. The full, fixed v1 command surface (docs/ORAM_SPECIFICATION_v1.md's companion CLI table lives in ORAM_V3_MIGRATION_PLAN.md Section 6). */
export const COMMANDS: Readonly<Record<string, CommandHandler>> = {
  init: initCommand,
  run: runCommand,
  analyze: analyzeCommand,
  plan: planCommand,
  execute: executeCommand,
  validate: validateCommand,
  inspect: inspectCommand,
  dashboard: dashboardCommand,
  doctor: doctorCommand,
  replay: replayCommand,
};

/**
 * The CLI's single entry point: dispatches argv[0] to its command handler. Returns the process exit code --
 * never calls process.exit() itself, matching scripts/gvams-cli.js's own main()/process.exitCode convention
 * so this module stays testable without spawning a real process.
 * @param argv arguments after the command name (i.e. process.argv.slice(2))
 */
export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const handler = command ? COMMANDS[command] : undefined;

  if (!handler) {
    console.log("Usage: oram <command> [options]");
    console.log(`Commands: ${Object.keys(COMMANDS).join(", ")}`);
    return command ? 1 : 0;
  }

  return handler(rest);
}
