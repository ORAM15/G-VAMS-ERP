/**
 * EngineeringKnowledge — Capability Sprint 1, Phase 2 (Engineering Knowledge).
 *
 * Repository Analysis (../../repository-analyzer/) answers "what exists?" -- Engineering Knowledge answers
 * "what does it mean?" by transforming an already-computed RepositoryAnalysis into subsystems, dependency
 * relationships, a narrative summary, and evidence-based strengths/risks/debt/missing-practice findings.
 * Deterministic, no LLM, no re-walking the filesystem -- RepositoryAnalysis is its one and only source of
 * facts (the same discipline scripts/engineering-knowledge.js's own header comment already established for
 * its legacy predecessor: "never re-walks the repository... is its one and only source of repository facts").
 *
 * Reuses Detection<T>/Confidence from the repository-analyzer package rather than redefining an equivalent
 * shape -- both live in @oram/engines, so this is a plain in-package import, not a new cross-package
 * dependency.
 */

export type { Confidence, Detection } from "../../repository-analyzer/analysis/types";
import type { Confidence, Detection } from "../../repository-analyzer/analysis/types";

export type SubsystemRole = "source" | "package" | "infrastructure" | "config" | "scripts" | "ci" | "tests" | "docs" | "unknown";

export interface Subsystem {
  readonly name: string;
  readonly path: string;
  readonly role: SubsystemRole;
  readonly responsibility: string;
  readonly relatedFrameworks: ReadonlyArray<string>;
  readonly relatedTechnologies: ReadonlyArray<string>;
  readonly evidence: ReadonlyArray<string>;
  readonly confidence: Confidence;
}

export type DependencyRelationshipKind =
  | "uses-framework"
  | "uses-api-framework"
  | "uses-database"
  | "uses-auth"
  | "uses-ai"
  | "uses-cloud"
  | "uses-build-tool"
  | "uses-test-framework";

/** `from` is a subsystem name when the owning manifest sits inside that subsystem's own directory, otherwise the project name (a repository-wide dependency not attributable to one specific subdirectory). */
export interface DependencyRelationship {
  readonly from: string;
  readonly to: string;
  readonly kind: DependencyRelationshipKind;
  readonly evidence: ReadonlyArray<string>;
  readonly confidence: Confidence;
}

export interface EngineeringKnowledge {
  readonly sourceProjectName: string;
  readonly sourceTimestamp: string;
  readonly architectureSummary: Detection<string>;
  readonly technologyStackNarrative: Detection<string>;
  readonly subsystems: ReadonlyArray<Subsystem>;
  readonly dependencyRelationships: ReadonlyArray<DependencyRelationship>;
  readonly architecturalStrengths: ReadonlyArray<Detection<string>>;
  readonly architecturalRisks: ReadonlyArray<Detection<string>>;
  readonly technicalDebtAreas: ReadonlyArray<Detection<string>>;
  readonly missingEngineeringPractices: ReadonlyArray<Detection<string>>;
  readonly timestamp: string;
}
