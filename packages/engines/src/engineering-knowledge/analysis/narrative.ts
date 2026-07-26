/**
 * Template-generated (non-AI) prose: an overall architecture summary and a technology-stack narrative,
 * assembled only from fields RepositoryAnalysis already computed -- every sentence traces back to a specific
 * Detection, never an inference this module invents on its own.
 */

import type { RepositoryAnalysis, Detection, Confidence } from "../../repository-analyzer/analysis/types";

function weakestConfidence(confidences: ReadonlyArray<Confidence>): Confidence {
  if (confidences.includes("Low")) return "Low";
  if (confidences.includes("Medium")) return "Medium";
  return confidences.length > 0 ? "High" : "Low";
}

export function buildArchitectureSummary(analysis: RepositoryAnalysis, subsystemCount: number): Detection<string> {
  if (analysis.projectType.value === "Unknown") {
    return { value: "Unknown", confidence: "Low", evidence: [], sourceFiles: [] };
  }

  const parts: string[] = [`${analysis.projectName} is a ${analysis.projectType.value}.`];
  const primaryLanguages = analysis.primaryLanguages.filter((entry) => entry.value !== "Unknown").map((entry) => entry.value);
  if (primaryLanguages.length > 0) parts.push(`Primary language(s): ${primaryLanguages.join(", ")}.`);

  const strongPattern = analysis.architecturalPatterns.find((pattern) => pattern.value !== "Unknown");
  if (strongPattern) parts.push(`${strongPattern.value}.`);

  if (analysis.monorepo.value) parts.push("The repository is organized as a monorepo.");
  parts.push(`${subsystemCount} subsystem(s) were identified.`);

  const evidence = [...analysis.projectType.evidence, ...(strongPattern?.evidence ?? [])];
  const sourceFiles = [...analysis.projectType.sourceFiles, ...(strongPattern?.sourceFiles ?? [])];
  const confidence = weakestConfidence([analysis.projectType.confidence, ...(strongPattern ? [strongPattern.confidence] : [])]);

  return { value: parts.join(" "), confidence, evidence: [...new Set(evidence)], sourceFiles: [...new Set(sourceFiles)] };
}

export function buildTechnologyStackNarrative(analysis: RepositoryAnalysis): Detection<string> {
  const segments: string[] = [];
  const evidence: string[] = [];
  const sourceFiles: string[] = [];

  function describe(label: string, detections: ReadonlyArray<Detection<string>>): void {
    if (detections.length === 0) return;
    segments.push(`${label}: ${detections.map((d) => d.value).join(", ")}`);
    for (const detection of detections) {
      evidence.push(...detection.evidence);
      sourceFiles.push(...detection.sourceFiles);
    }
  }

  describe("Frameworks", analysis.frameworks);
  describe("API frameworks", analysis.apiFrameworks);
  describe("Databases", analysis.databaseTechnologies);
  describe("Authentication", analysis.authenticationLibraries);
  describe("AI/LLM", analysis.aiLlmLibraries);
  describe("Cloud", analysis.cloudProviders);
  describe("Build tools", analysis.buildTools);
  describe("Testing", analysis.testingFrameworks);

  if (segments.length === 0) {
    return { value: "Unknown", confidence: "Low", evidence: [], sourceFiles: [] };
  }
  return { value: `${segments.join(". ")}.`, confidence: "High", evidence: [...new Set(evidence)], sourceFiles: [...new Set(sourceFiles)] };
}
