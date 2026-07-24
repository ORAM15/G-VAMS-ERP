#!/usr/bin/env node
// Copies the three already-generated Phase 3 engine outputs into frontend/public/autonomous-engineer-data/
// so the Autonomous Engineer Dashboard (frontend/src/pages/AutonomousEngineer.js) can fetch them at
// runtime as plain static assets. This script never computes, regenerates, or re-derives any repository
// data itself -- it only copies files that scripts/repository-intelligence.js, scripts/engineering-
// knowledge.js, and scripts/recommendation-engine.js have already produced.
//
// Wired into `npm run prestart` / `npm run prebuild` so the dashboard has fresh data whenever the app
// starts or builds. A source that has not been generated yet is skipped with a warning (not an error) --
// this script always exits 0 so a fresh checkout that hasn't run the engines yet can still `npm start`;
// the dashboard page itself shows a "not generated yet" notice per missing section instead.
const fs = require("fs");
const path = require("path");

const frontendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const destDir = path.join(frontendRoot, "public", "autonomous-engineer-data");

const SOURCES = [
  { file: "repository-analysis.json", source: path.join(repoRoot, "repository-intelligence", "repository-analysis.json"), generator: "node scripts/repository-intelligence.js" },
  { file: "engineering-knowledge.json", source: path.join(repoRoot, "engineering-knowledge", "engineering-knowledge.json"), generator: "node scripts/engineering-knowledge.js" },
  { file: "recommendations.json", source: path.join(repoRoot, "recommendations", "recommendations.json"), generator: "node scripts/recommendation-engine.js" },
];

function main() {
  fs.mkdirSync(destDir, { recursive: true });
  let copied = 0;
  for (const { file, source, generator } of SOURCES) {
    if (!fs.existsSync(source)) {
      console.warn(`[sync-autonomous-data] skipped ${file}: not found at ${path.relative(repoRoot, source)}. Run \`${generator}\` first.`);
      continue;
    }
    fs.copyFileSync(source, path.join(destDir, file));
    copied += 1;
    console.log(`[sync-autonomous-data] synced ${file}`);
  }
  console.log(`[sync-autonomous-data] ${copied}/${SOURCES.length} source file(s) synced into ${path.relative(frontendRoot, destDir)}`);
}

main();
