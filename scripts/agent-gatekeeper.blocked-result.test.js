#!/usr/bin/env node
const fs = require("fs");
const source = fs.readFileSync("scripts/agent-gatekeeper.js", "utf8");
const required = [
  'r.outcome === "success"',
  'r.outcome === "blocked" && Array.isArray(r.changed_files)',
  "blocked result cannot claim changed files",
  "blocked result must carry explicit provider-capacity evidence",
  "/capacity|provider|rate.?limit|exhaust/i"
];
for (const text of required) {
  if (!source.includes(text)) throw new Error(`Missing blocked result gate contract: ${text}`);
}
console.log("Blocked result gate contract is present.");
