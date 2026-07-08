#!/usr/bin/env node
const fs = require("fs");
const source = fs.readFileSync("scripts/agent-runtime-adapter.js", "utf8");
const required = [
  "classifyOpenHandsEvidence",
  "free-models-per-day",
  "RateLimitError",
  "OpenRouter implementation capacity was exhausted or rate-limited",
  "OpenHands process exited zero but provider failure evidence was detected"
];
for (const text of required) {
  if (!source.includes(text)) throw new Error(`Missing provider evidence contract: ${text}`);
}
console.log("OpenHands provider failure evidence contract is present.");
