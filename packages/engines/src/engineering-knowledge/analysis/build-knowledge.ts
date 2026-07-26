/**
 * buildEngineeringKnowledge() — the single entry point assembling every deterministic detector in this
 * directory into one EngineeringKnowledge (./types.ts), from an already-computed RepositoryAnalysis.
 */

import type { RepositoryAnalysis, Confidence } from "../../repository-analyzer/analysis/types";
import { detectSubsystemBases, type SubsystemBase } from "./subsystems";
import { detectDependencyRelationships } from "./dependency-relationships";
import { buildArchitectureSummary, buildTechnologyStackNarrative } from "./narrative";
import { detectArchitecturalStrengths, detectArchitecturalRisks, detectTechnicalDebtAreas, detectMissingEngineeringPractices } from "./rules";
import type { EngineeringKnowledge, Subsystem, DependencyRelationship } from "./types";

function attachAssociations(bases: ReadonlyArray<SubsystemBase>, relationships: ReadonlyArray<DependencyRelationship>): Subsystem[] {
  return bases.map((base) => {
    const own = relationships.filter((relationship) => relationship.from === base.name);
    const relatedFrameworks = [...new Set(own.filter((r) => r.kind === "uses-framework" || r.kind === "uses-api-framework").map((r) => r.to))];
    const relatedTechnologies = [...new Set(own.filter((r) => r.kind !== "uses-framework" && r.kind !== "uses-api-framework").map((r) => r.to))];
    const evidence = [...new Set([base.path, ...own.flatMap((r) => r.evidence)])];
    const confidence: Confidence = own.length > 0 ? "High" : "Low";
    const allLabels = [...new Set(own.map((r) => r.to))];
    const responsibility =
      allLabels.length > 0
        ? `${base.role === "package" ? "Workspace package" : "Directory"} \`${base.path}\` (${base.role}) is associated with: ${allLabels.join(", ")}.`
        : `General ${base.role} directory \`${base.path}\`; no specific technology could be attributed to this path from its own manifest.`;

    return {
      name: base.name,
      path: base.path,
      role: base.role,
      responsibility,
      relatedFrameworks,
      relatedTechnologies,
      evidence,
      confidence,
    };
  });
}

export function buildEngineeringKnowledge(analysis: RepositoryAnalysis): EngineeringKnowledge {
  const bases = detectSubsystemBases(analysis);
  const relationships = detectDependencyRelationships(analysis, bases, analysis.projectName);
  const subsystems = attachAssociations(bases, relationships);

  return {
    sourceProjectName: analysis.projectName,
    sourceTimestamp: analysis.timestamp,
    architectureSummary: buildArchitectureSummary(analysis, subsystems.length),
    technologyStackNarrative: buildTechnologyStackNarrative(analysis),
    subsystems,
    dependencyRelationships: relationships,
    architecturalStrengths: detectArchitecturalStrengths(analysis),
    architecturalRisks: detectArchitecturalRisks(analysis),
    technicalDebtAreas: detectTechnicalDebtAreas(analysis),
    missingEngineeringPractices: detectMissingEngineeringPractices(analysis),
    timestamp: new Date().toISOString(),
  };
}
