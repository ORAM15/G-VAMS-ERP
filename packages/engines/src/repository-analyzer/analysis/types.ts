/**
 * RepositoryAnalysis v2 — the rich, evidence-based analysis shape for Capability Sprint 1 (Milestone 1:
 * Intelligent Repository Analysis).
 *
 * DESIGN
 * Every detected capability is a Detection<T>: a value, a confidence level, and the evidence/source files
 * that justify it. Nothing is ever asserted without evidence -- when no evidence exists for a singular field
 * (projectType, monorepo, docker, the primary architectural pattern), its Detection's `value` is the literal
 * string "Unknown" (or `false` for booleans) with `confidence: "Low"` and empty evidence -- never a guess. For
 * plural fields (frameworks, databases, etc.), "nothing found" is an empty array, not a fabricated "Unknown"
 * entry -- an empty list already communicates "none detected" honestly.
 *
 * Deliberately NOT a rewrite of LegacyRepositoryAnalysis (./types.ts, wrapping scripts/repository-
 * intelligence.js) -- that type and its adapter are untouched and still valid. This is a new, independent,
 * repository-agnostic analysis produced by a new engine (../RepositoryAnalyzerEngine.ts), generic across any
 * repository (no MP6-specific "frontend"/"backend" assumptions anywhere in this shape or its detectors).
 */

export type Confidence = "High" | "Medium" | "Low";

/** One evidence-backed detection. `value` is the detected fact itself (e.g. "React", true, "Unknown"). */
export interface Detection<T> {
  readonly value: T;
  readonly confidence: Confidence;
  /** Human-readable evidence descriptions, e.g. "package.json dependencies", "Dockerfile present". */
  readonly evidence: ReadonlyArray<string>;
  /** Repository-relative paths that back this detection. */
  readonly sourceFiles: ReadonlyArray<string>;
}

export interface LanguageEntry {
  readonly language: string;
  readonly fileCount: number;
}

export interface DependencyManifestSummary {
  readonly path: string;
  readonly ecosystem: string;
  readonly dependencyCount: number;
}

export interface DependencySummary {
  readonly totalDependencies: number;
  readonly manifests: ReadonlyArray<DependencyManifestSummary>;
}

/** `role` is a naming-convention-based categorization, not an assertion about the directory's real purpose. */
export interface RepositoryStructureEntry {
  readonly path: string;
  readonly role:
    | "source"
    | "tests"
    | "docs"
    | "scripts"
    | "ci"
    | "infrastructure"
    | "config"
    | "package"
    | "unknown";
}

export interface RepositoryAnalysis {
  readonly projectName: string;
  readonly projectType: Detection<string>;
  readonly languages: ReadonlyArray<LanguageEntry>;
  readonly primaryLanguages: ReadonlyArray<Detection<string>>;
  readonly frameworks: ReadonlyArray<Detection<string>>;
  readonly apiFrameworks: ReadonlyArray<Detection<string>>;
  readonly packageManagers: ReadonlyArray<Detection<string>>;
  readonly buildTools: ReadonlyArray<Detection<string>>;
  readonly testingFrameworks: ReadonlyArray<Detection<string>>;
  readonly repositoryStructure: ReadonlyArray<RepositoryStructureEntry>;
  readonly entryPoints: ReadonlyArray<Detection<string>>;
  readonly configurationFiles: ReadonlyArray<Detection<string>>;
  readonly dependencySummary: DependencySummary;
  readonly architecturalPatterns: ReadonlyArray<Detection<string>>;
  readonly monorepo: Detection<boolean>;
  readonly environmentFiles: ReadonlyArray<Detection<string>>;
  readonly ciCdSystems: ReadonlyArray<Detection<string>>;
  readonly docker: Detection<boolean>;
  readonly infrastructureFiles: ReadonlyArray<Detection<string>>;
  readonly databaseTechnologies: ReadonlyArray<Detection<string>>;
  readonly authenticationLibraries: ReadonlyArray<Detection<string>>;
  readonly aiLlmLibraries: ReadonlyArray<Detection<string>>;
  readonly cloudProviders: ReadonlyArray<Detection<string>>;
  readonly deploymentTargets: ReadonlyArray<Detection<string>>;
  readonly fileCount: number;
  readonly timestamp: string;
}
