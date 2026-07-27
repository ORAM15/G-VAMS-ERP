/**
 * Dev-mode entry point for the `oram` command -- see package.json's `bin` field and ./index.ts's own
 * "add a real bin/oram entry point once a build step exists" TODO. No build step exists yet, so this
 * runs directly through tsx (`npx tsx packages/cli/src/bin.ts <command> ...`) instead of a compiled
 * dist/bin.js. Thin process wrapper only -- all real dispatch logic stays in ./index.ts's main().
 */
import { main } from "./index";

main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
