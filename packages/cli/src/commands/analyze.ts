/**
 * `oram analyze <path>` — runs the complete Repository Analysis -> Engineering Knowledge -> Engineering
 * Reasoning pipeline directly (no @oram/runtime involved: no Lifecycle, no EngineRunner, no ArtifactStore,
 * no EventBus) and prints a presentation-ready console report.
 *
 * PURPOSE: a fast, side-effect-free, presentation-ready demo of what ORAM's Intelligence layer already
 * produces for a given repository -- persisting nothing, publishing nothing, calling no Provider. This is
 * deliberately NOT the same thing as a future `oram run`, which will go through the real Runtime/Lifecycle;
 * this command exists to demo @oram/engines' pipeline on its own, exactly as it is today.
 *
 * Does not modify @oram/engines in any way -- only imports and calls its existing, already-tested pure
 * functions (buildRepositoryAnalysis / buildEngineeringKnowledge / buildEngineeringReasoning).
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { buildRepositoryAnalysis, buildEngineeringKnowledge, buildEngineeringReasoning } from "@oram/engines";
import { renderAnalysisReport } from "../report/renderAnalysisReport";

export async function analyzeCommand(args: string[]): Promise<number> {
  const targetPath = path.resolve(args[0] ?? process.cwd());

  if (!existsSync(targetPath)) {
    console.error(`oram analyze: path not found: ${targetPath}`);
    return 1;
  }

  const startedAt = Date.now();
  const analysis = buildRepositoryAnalysis(targetPath);
  const knowledge = buildEngineeringKnowledge(analysis);
  const reasoning = buildEngineeringReasoning(knowledge);
  const elapsedMs = Date.now() - startedAt;

  console.log(renderAnalysisReport({ analysis, knowledge, reasoning, elapsedMs }));
  return 0;
}
