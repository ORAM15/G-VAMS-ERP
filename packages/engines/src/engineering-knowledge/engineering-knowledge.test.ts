/**
 * Regression coverage for Engineering Knowledge v2 (Capability Sprint 1, Phase 2). Reuses the repository-
 * analyzer package's own fixtures (../repository-analyzer/__fixtures__/) rather than duplicating them --
 * buildEngineeringKnowledge() is a pure transform of a RepositoryAnalysis, so those fixtures already give
 * precise, hand-computed inputs to assert against.
 *
 * Run with: node --import tsx --test packages/engines/src/engineering-knowledge/engineering-knowledge.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { buildRepositoryAnalysis } from "../repository-analyzer/analysis/build-analysis";
import { buildEngineeringKnowledge } from "./analysis/build-knowledge";
import type { Detection } from "../repository-analyzer/analysis/types";
import type { EngineeringKnowledge } from "./analysis/types";

const FIXTURES_ROOT = path.join(import.meta.dirname, "..", "repository-analyzer", "__fixtures__");

/** Same loader-independent walk-up as repository-analyzer.v2.test.ts's own findRepositoryRoot() -- see that file's comment for why a hardcoded relative `..` offset is deliberately avoided here. */
function findRepositoryRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path.join(dir, "scripts", "repository-intelligence.js"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find a repository root containing scripts/repository-intelligence.js above ${startDir}.`);
}

function knowledgeFor(fixtureName: string): EngineeringKnowledge {
  const analysis = buildRepositoryAnalysis(path.join(FIXTURES_ROOT, fixtureName));
  return buildEngineeringKnowledge(analysis);
}

function values(detections: ReadonlyArray<Detection<string>>): Set<string> {
  return new Set(detections.map((d) => d.value));
}

function assertWellFormedDetection<T>(detection: Detection<T>): void {
  assert.ok(["High", "Medium", "Low"].includes(detection.confidence));
  assert.ok(Array.isArray(detection.evidence));
  assert.ok(Array.isArray(detection.sourceFiles));
}

test("web-app fixture: single-package repo attributes all technologies to the project, not to `src`", () => {
  const knowledge = knowledgeFor("web-app");

  assert.equal(knowledge.subsystems.length, 1);
  const src = knowledge.subsystems[0]!;
  assert.equal(src.path, "src");
  assert.equal(src.role, "source");
  assert.deepEqual(src.relatedFrameworks, []);
  assert.deepEqual(src.relatedTechnologies, []);
  assert.equal(src.confidence, "Low");

  assert.equal(knowledge.dependencyRelationships.length, 11);
  assert.ok(knowledge.dependencyRelationships.every((r) => r.from === "demo-web-app"));
  assert.ok(knowledge.dependencyRelationships.some((r) => r.to === "React" && r.kind === "uses-framework"));
  assert.ok(knowledge.dependencyRelationships.some((r) => r.to === "Express" && r.kind === "uses-api-framework"));

  assert.equal(knowledge.architectureSummary.value, "demo-web-app is a Full-stack web application. Primary language(s): JavaScript. Likely MVC (Model-View-Controller). 1 subsystem(s) were identified.");
  assert.equal(knowledge.architectureSummary.confidence, "High");

  assert.equal(knowledge.technologyStackNarrative.confidence, "High");
  assert.ok(knowledge.technologyStackNarrative.value.includes("Frameworks: React"));

  assert.deepEqual(values(knowledge.architecturalStrengths), new Set([
    "Automated testing is configured (Jest).",
    "Continuous integration is configured (GitHub Actions).",
    "Containerization (Docker) supports reproducible builds/deployments.",
    "An ORM/ODM is used (MongoDB (Mongoose)), reducing raw-query risk and improving maintainability.",
    "A recognizable architectural pattern was detected (Likely MVC (Model-View-Controller)), suggesting intentional structural organization.",
    "Configuration is externalized via environment files rather than hardcoded.",
  ]));
  assert.deepEqual(knowledge.architecturalRisks, []);
  assert.deepEqual(knowledge.technicalDebtAreas, []);
  assert.deepEqual(knowledge.missingEngineeringPractices, []);

  for (const detection of [knowledge.architectureSummary, knowledge.technologyStackNarrative, ...knowledge.architecturalStrengths]) {
    assertWellFormedDetection(detection);
  }
  for (const relationship of knowledge.dependencyRelationships) {
    assert.ok(["High", "Medium", "Low"].includes(relationship.confidence));
    assert.ok(Array.isArray(relationship.evidence));
  }
});

test("clean-architecture fixture: TypeScript + Clean Architecture strengths, missing testing/CI/lint flagged", () => {
  const knowledge = knowledgeFor("clean-architecture");

  assert.equal(knowledge.subsystems.length, 1);
  assert.equal(knowledge.subsystems[0]!.path, "src");

  assert.equal(knowledge.dependencyRelationships.length, 1);
  assert.equal(knowledge.dependencyRelationships[0]?.to, "TypeScript");
  assert.equal(knowledge.dependencyRelationships[0]?.from, "demo-clean-architecture");

  assert.deepEqual(values(knowledge.architecturalStrengths), new Set([
    "Static typing (TypeScript) is used, reducing a class of runtime errors.",
    "A recognizable architectural pattern was detected (Likely Clean/Hexagonal Architecture), suggesting intentional structural organization.",
  ]));

  assert.equal(knowledge.technicalDebtAreas.length, 1);
  assert.ok(knowledge.technicalDebtAreas[0]?.value.includes("no matching lockfile"));

  assert.deepEqual(values(knowledge.missingEngineeringPractices), new Set([
    "No automated testing framework was detected.",
    "No CI/CD configuration was detected.",
    "No ESLint configuration was detected for this JavaScript/TypeScript codebase.",
  ]));
});

test("python-fastapi fixture: pip ecosystem produces FastAPI/SQLAlchemy strengths, missing CI/env flagged, no false ESLint claim", () => {
  const knowledge = knowledgeFor("python-fastapi");

  // No directories in this fixture at all -- honestly zero subsystems, not a guess.
  assert.deepEqual(knowledge.subsystems, []);

  assert.equal(knowledge.dependencyRelationships.length, 6);
  assert.ok(knowledge.dependencyRelationships.every((r) => r.from === "python-fastapi"));

  assert.deepEqual(values(knowledge.architecturalStrengths), new Set([
    "Automated testing is configured (pytest).",
    "Containerization (Docker) supports reproducible builds/deployments.",
    "An ORM/ODM is used (SQLAlchemy), reducing raw-query risk and improving maintainability.",
  ]));
  assert.deepEqual(knowledge.architecturalRisks, []);

  assert.equal(knowledge.technicalDebtAreas.length, 1);
  assert.ok(knowledge.technicalDebtAreas[0]?.value.includes("poetry/Pipenv lockfile"));

  const missing = values(knowledge.missingEngineeringPractices);
  assert.deepEqual(missing, new Set([
    "No CI/CD configuration was detected.",
    "Database/authentication dependencies were detected but no .env-pattern file (e.g. .env.example) was found -- onboarding configuration may be undocumented.",
  ]));
  // Never a false claim about a language-specific practice this analyzer didn't actually check for.
  assert.ok(![...missing].some((v) => v.includes("ESLint")));
});

test("monorepo fixture: package.json-per-workspace attributes React/Express to their own package, not the repo", () => {
  const knowledge = knowledgeFor("monorepo");

  assert.equal(knowledge.subsystems.length, 2);
  const pkgA = knowledge.subsystems.find((s) => s.path === "packages/pkg-a");
  const pkgB = knowledge.subsystems.find((s) => s.path === "packages/pkg-b");
  assert.ok(pkgA && pkgB);
  assert.deepEqual(pkgA!.relatedFrameworks, ["React"]);
  assert.equal(pkgA!.confidence, "High");
  assert.deepEqual(pkgB!.relatedFrameworks, ["Express"]);

  assert.equal(knowledge.dependencyRelationships.length, 2);
  assert.ok(knowledge.dependencyRelationships.some((r) => r.from === "packages/pkg-a" && r.to === "React"));
  assert.ok(knowledge.dependencyRelationships.some((r) => r.from === "packages/pkg-b" && r.to === "Express"));

  assert.deepEqual(knowledge.architecturalStrengths, []);
  assert.deepEqual(values(knowledge.architecturalRisks), new Set([
    "An API framework (Express) was detected with no authentication library evidence -- verify access control is implemented.",
    "A monorepo was detected with no CI/CD configuration -- changes may not be automatically verified across workspace packages.",
  ]));
  assert.deepEqual(knowledge.technicalDebtAreas, []);
  assert.deepEqual(values(knowledge.missingEngineeringPractices), new Set([
    "No automated testing framework was detected.",
    "No CI/CD configuration was detected.",
    "No ESLint configuration was detected for this JavaScript/TypeScript codebase.",
    "No entry point was detected (no package.json main/bin field, no conventional entry filename).",
  ]));

  assert.ok(knowledge.architectureSummary.value.includes("monorepo"));
});

test("minimal fixture: zero evidence yields Unknown narrative and only the practices that can honestly be checked with no manifest", () => {
  const knowledge = knowledgeFor("minimal");

  assert.deepEqual(knowledge.subsystems, []);
  assert.deepEqual(knowledge.dependencyRelationships, []);
  assert.equal(knowledge.architectureSummary.value, "Unknown");
  assert.equal(knowledge.architectureSummary.confidence, "Low");
  assert.equal(knowledge.technologyStackNarrative.value, "Unknown");
  assert.deepEqual(knowledge.architecturalStrengths, []);
  assert.deepEqual(knowledge.architecturalRisks, []);
  assert.deepEqual(knowledge.technicalDebtAreas, []);
  assert.deepEqual(values(knowledge.missingEngineeringPractices), new Set([
    "No automated testing framework was detected.",
    "No CI/CD configuration was detected.",
    "No entry point was detected (no package.json main/bin field, no conventional entry filename).",
  ]));
});

test("smoke test: buildEngineeringKnowledge() runs against this actual repository's own analysis without crashing", () => {
  const repoRoot = findRepositoryRoot(import.meta.dirname);
  const analysis = buildRepositoryAnalysis(repoRoot);
  const knowledge = buildEngineeringKnowledge(analysis);

  assert.ok(["High", "Medium", "Low"].includes(knowledge.architectureSummary.confidence));
  assert.ok(typeof knowledge.timestamp === "string" && Number.isFinite(Date.parse(knowledge.timestamp)));
  for (const detection of [knowledge.architectureSummary, knowledge.technologyStackNarrative, ...knowledge.architecturalStrengths, ...knowledge.missingEngineeringPractices]) {
    assertWellFormedDetection(detection);
  }
});
