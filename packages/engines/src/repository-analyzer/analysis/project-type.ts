/**
 * Project-type classification -- combines already-computed Detections (frameworks, API frameworks, entry
 * points, monorepo) into a single top-level answer. Never introduces new evidence of its own: every fact it
 * cites is copied from the Detections it was given, so it can never be more confident than what already had
 * evidence behind it.
 */

import type { Confidence, Detection } from "./types";

export interface ProjectTypeInput {
  readonly frameworks: ReadonlyArray<Detection<string>>;
  readonly apiFrameworks: ReadonlyArray<Detection<string>>;
  readonly entryPoints: ReadonlyArray<Detection<string>>;
  readonly monorepo: Detection<boolean>;
}

function collect(detections: ReadonlyArray<Detection<unknown>>, evidence: string[], sourceFiles: Set<string>): void {
  for (const detection of detections) {
    evidence.push(...detection.evidence);
    for (const file of detection.sourceFiles) sourceFiles.add(file);
  }
}

export function detectProjectType({ frameworks, apiFrameworks, entryPoints, monorepo }: ProjectTypeInput): Detection<string> {
  const hasFrontend = frameworks.length > 0;
  const hasApi = apiFrameworks.length > 0;
  const hasCli = entryPoints.some((entry) => entry.evidence.some((line) => line.includes('"bin" field')));

  const evidence: string[] = [];
  const sourceFiles = new Set<string>();
  let value: string;
  let confidence: Confidence;

  if (monorepo.value && hasFrontend && hasApi) {
    value = "Monorepo (full-stack web application)";
    confidence = "High";
    collect(frameworks, evidence, sourceFiles);
    collect(apiFrameworks, evidence, sourceFiles);
    collect([monorepo], evidence, sourceFiles);
  } else if (monorepo.value) {
    value = "Monorepo";
    confidence = monorepo.confidence;
    collect([monorepo], evidence, sourceFiles);
  } else if (hasFrontend && hasApi) {
    value = "Full-stack web application";
    confidence = "High";
    collect(frameworks, evidence, sourceFiles);
    collect(apiFrameworks, evidence, sourceFiles);
  } else if (hasFrontend) {
    value = "Frontend web application";
    confidence = "Medium";
    collect(frameworks, evidence, sourceFiles);
  } else if (hasApi) {
    value = "Backend API service";
    confidence = "Medium";
    collect(apiFrameworks, evidence, sourceFiles);
  } else if (hasCli) {
    value = "CLI tool";
    confidence = "Medium";
    evidence.push('package.json "bin" field present');
  } else if (entryPoints.some((entry) => entry.confidence === "High")) {
    value = "Library/package";
    confidence = "Low";
    collect(
      entryPoints.filter((entry) => entry.confidence === "High"),
      evidence,
      sourceFiles
    );
  } else {
    return { value: "Unknown", confidence: "Low", evidence: [], sourceFiles: [] };
  }

  return { value, confidence, evidence: [...new Set(evidence)], sourceFiles: [...sourceFiles] };
}
