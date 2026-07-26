/**
 * Attributes every technology Detection from RepositoryAnalysis to whichever subsystem actually owns the
 * manifest that declared it -- a dependency declared in packages/pkg-a/package.json is attributed to the
 * "packages/pkg-a" subsystem; a dependency declared in a single, repository-root package.json (the common
 * single-package case) has no one subsystem that owns it, so it is attributed to the repository as a whole
 * (`repositoryLabel`, the project name) instead of being falsely pinned to an arbitrary subdirectory.
 */

import type { RepositoryAnalysis, Detection } from "../../repository-analyzer/analysis/types";
import type { SubsystemBase } from "./subsystems";
import type { DependencyRelationship, DependencyRelationshipKind } from "./types";

const CATEGORY_KIND: Readonly<Record<string, DependencyRelationshipKind>> = {
  framework: "uses-framework",
  "api-framework": "uses-api-framework",
  database: "uses-database",
  auth: "uses-auth",
  ai: "uses-ai",
  cloud: "uses-cloud",
  "build-tool": "uses-build-tool",
  "test-framework": "uses-test-framework",
};

function manifestDirectory(manifestPath: string): string {
  const idx = manifestPath.lastIndexOf("/");
  return idx === -1 ? "" : manifestPath.slice(0, idx);
}

function findOwningSubsystem(manifestPath: string, subsystems: ReadonlyArray<SubsystemBase>): SubsystemBase | null {
  const dir = manifestDirectory(manifestPath);
  return subsystems.find((subsystem) => subsystem.path === dir) ?? null;
}

export function detectDependencyRelationships(
  analysis: RepositoryAnalysis,
  subsystems: ReadonlyArray<SubsystemBase>,
  repositoryLabel: string
): DependencyRelationship[] {
  const relationships: DependencyRelationship[] = [];
  const categorized: ReadonlyArray<[string, ReadonlyArray<Detection<string>>]> = [
    ["framework", analysis.frameworks],
    ["api-framework", analysis.apiFrameworks],
    ["database", analysis.databaseTechnologies],
    ["auth", analysis.authenticationLibraries],
    ["ai", analysis.aiLlmLibraries],
    ["cloud", analysis.cloudProviders],
    ["build-tool", analysis.buildTools],
    ["test-framework", analysis.testingFrameworks],
  ];

  for (const [category, detections] of categorized) {
    for (const detection of detections) {
      const filesByOwner = new Map<string, string[]>();
      for (const file of detection.sourceFiles) {
        const owner = findOwningSubsystem(file, subsystems);
        const ownerLabel = owner ? owner.name : repositoryLabel;
        const files = filesByOwner.get(ownerLabel) ?? [];
        files.push(file);
        filesByOwner.set(ownerLabel, files);
      }
      for (const [ownerLabel, files] of filesByOwner.entries()) {
        relationships.push({
          from: ownerLabel,
          to: detection.value,
          kind: CATEGORY_KIND[category]!,
          evidence: files,
          confidence: detection.confidence,
        });
      }
    }
  }

  return relationships;
}
