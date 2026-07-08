#!/usr/bin/env node
const fs = require("fs");
const source = fs.readFileSync("scripts/agent-runtime-adapter.js", "utf8");
const required = [
  "AGENT_MAX_LINE_CHANGES",
  "HARD DELTA BUDGET",
  "git diff --numstat",
  "outcome=blocked",
  "Do not rewrite whole files"
];
for (const text of required) {
  if (!source.includes(text)) throw new Error(`Missing delta-budget contract: ${text}`);
}
console.log("Delta-budget implementation contract is present.");
