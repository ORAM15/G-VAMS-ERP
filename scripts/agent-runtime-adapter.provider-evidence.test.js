#!/usr/bin/env node
const fs = require("fs");
const source = fs.readFileSync("scripts/agent-runtime-adapter.js", "utf8");
const required = [
  "classifyOpenHandsEvidence",
  "writeProviderCapacityBlock",
  "free-models-per-day",
  "RateLimitError",
  "OpenRouter implementation capacity was exhausted or rate-limited",
  'outcome: "blocked"',
  "Restore OpenRouter implementation capacity or configure an approved implementation provider",
  "BLOCKED:"
];
for (const text of required) {
  if (!source.includes(text)) throw new Error(`Missing provider capacity contract: ${text}`);
}
console.log("OpenHands blocked provider capacity contract is present.");