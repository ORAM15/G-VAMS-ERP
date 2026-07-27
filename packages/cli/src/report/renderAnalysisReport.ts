/**
 * renderAnalysisReport() — pure, presentation-only formatting for `oram analyze`'s console report.
 *
 * Deliberately separate from analyzeCommand.ts: this function takes already-computed pipeline output plus
 * an explicit `elapsedMs` (never measures time itself), so it is fully deterministic and directly testable
 * without spawning a process or capturing real timing -- see report/renderAnalysisReport.test.ts.
 *
 * No color library (project convention -- see this package's own header comments elsewhere for "no new
 * dependency for something this simple"). Unicode icons only. Does not compute anything: every value here
 * was already produced by @oram/engines' RepositoryAnalyzer / EngineeringKnowledge / EngineeringReasoning --
 * this file only decides how to lay it out.
 */
import type { RepositoryAnalysis, EngineeringKnowledge, EngineeringReasoning, Finding, Severity } from "@oram/engines";

export interface AnalysisReportInput {
  readonly analysis: RepositoryAnalysis;
  readonly knowledge: EngineeringKnowledge;
  readonly reasoning: EngineeringReasoning;
  readonly elapsedMs: number;
}

const WIDTH = 52;
const RULE_DOUBLE = "=".repeat(WIDTH);
const RULE_SINGLE = "-".repeat(WIDTH);
const FINDING_RULE = "-".repeat(44);

/** Display titles for the 5 MVP Engineering Reasoning rules -- see @oram/engines' engineering-reasoning/analysis/rules.ts for their `kind`s. Falls back to the raw kind for any future rule this report doesn't know about yet, rather than crashing. */
const FINDING_TITLES: Readonly<Record<string, string>> = {
  "subsystem-concentration": "Concentrated Subsystem",
  "untested-api-surface": "Untested API Surface",
  "unverified-monorepo": "No CI/CD in Monorepo",
  "subsystem-api-without-auth": "API Without Authentication",
  "opaque-subsystems": "Opaque Subsystems",
};

const SEVERITY_ICON: Readonly<Record<Severity, string>> = { High: "⚠", Medium: "⚠", Low: "ℹ" };

function findingTitle(finding: Finding): string {
  return FINDING_TITLES[finding.kind] ?? finding.kind;
}

function shortLabel(text: string): string {
  const base = text.split("/").pop() ?? text;
  return base.length > 0 ? base.charAt(0).toUpperCase() + base.slice(1) : base;
}

/** "subsystem:<path>" -> that subsystem's own short label; "repository:<name>" (or anything else) -> the project name -- a repo-wide dependency has no one subsystem to name. */
function relationshipFromLabel(from: string, knowledge: EngineeringKnowledge, projectName: string): string {
  const subsystem = knowledge.subsystems.find((s) => s.id === from);
  return subsystem ? shortLabel(subsystem.path) : projectName;
}

function describeArchitecture(analysis: RepositoryAnalysis): string {
  const pattern = analysis.architecturalPatterns.find((p) => p.value !== "Unknown");
  if (pattern) return pattern.value;
  if (analysis.monorepo.value) return "Monorepo";
  return analysis.projectType.value;
}

function renderRepositorySection(analysis: RepositoryAnalysis): string[] {
  const language = analysis.primaryLanguages.find((l) => l.value !== "Unknown")?.value ?? "Unknown";
  const packageManager = analysis.packageManagers[0]?.value ?? "Unknown";
  return [
    "Repository",
    `✔ Name: ${analysis.projectName}`,
    `✔ Language: ${language}`,
    `✔ Package Manager: ${packageManager}`,
    `✔ Architecture: ${describeArchitecture(analysis)}`,
  ];
}

function renderKnowledgeSection(analysis: RepositoryAnalysis, knowledge: EngineeringKnowledge): string[] {
  const lines: string[] = [RULE_SINGLE, "Engineering Knowledge", RULE_SINGLE, "", "Subsystems"];
  if (knowledge.subsystems.length === 0) {
    lines.push("  (none detected)");
  } else {
    for (const subsystem of knowledge.subsystems) lines.push(`  • ${subsystem.path}`);
  }

  lines.push("", "Relationships");
  if (knowledge.dependencyRelationships.length === 0) {
    lines.push("  (none detected)");
  } else {
    for (const relationship of knowledge.dependencyRelationships) {
      lines.push(`  • ${relationshipFromLabel(relationship.from, knowledge, analysis.projectName)} → ${relationship.to}`);
    }
  }
  return lines;
}

function renderFindingsSection(reasoning: EngineeringReasoning): string[] {
  const lines: string[] = [RULE_SINGLE, "Engineering Findings", RULE_SINGLE, ""];
  if (reasoning.findings.length === 0) {
    lines.push("✔ No findings detected.");
    return lines;
  }
  for (const finding of reasoning.findings) {
    lines.push(`${SEVERITY_ICON[finding.severity]} ${finding.severity.toUpperCase()}`, findingTitle(finding), "", "Reason:", finding.summary, "", FINDING_RULE, "");
  }
  lines.pop(); // drop the trailing blank line after the last finding's rule
  return lines;
}

/** Right-pads `label` with dots up to a fixed column so every stat's value lines up, e.g. "Subsystems ............. 10". */
const STAT_LABEL_COLUMN = 24;

function statLine(label: string, value: string): string {
  const dots = ".".repeat(Math.max(STAT_LABEL_COLUMN - label.length - 1, 3));
  return `${label} ${dots} ${value}`;
}

function renderStatisticsSection(analysis: RepositoryAnalysis, knowledge: EngineeringKnowledge, reasoning: EngineeringReasoning, elapsedMs: number): string[] {
  return [
    RULE_SINGLE,
    "Statistics",
    RULE_SINGLE,
    "",
    statLine("Files Scanned", String(analysis.fileCount)),
    statLine("Subsystems", String(knowledge.subsystems.length)),
    statLine("Relationships", String(knowledge.dependencyRelationships.length)),
    statLine("Findings", String(reasoning.findings.length)),
    statLine("Execution Time", `${elapsedMs} ms`),
  ];
}

function renderFooterSection(): string[] {
  return [
    RULE_SINGLE,
    "Pipeline Status",
    RULE_SINGLE,
    "",
    "✔ Repository Analysis Complete",
    "✔ Engineering Knowledge Complete",
    "✔ Engineering Reasoning Complete",
    "",
    "Overall Status",
    "SUCCESS",
  ];
}

const PIPELINE_STAGES: ReadonlyArray<string> = ["Repository", "Repository Analysis", "Engineering Knowledge", "Engineering Reasoning"];

function centerLabel(label: string, innerWidth: number): string {
  const totalPad = innerWidth - label.length;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return `${" ".repeat(left)}${label}${" ".repeat(right)}`;
}

/** A boxed top-to-bottom flow diagram of the pipeline stages, printed before the report itself -- pure formatting over a fixed, hardcoded stage list (the pipeline's shape isn't something @oram/engines exposes, so this doesn't read it from anywhere). */
function renderPipelineDiagram(stages: ReadonlyArray<string>): string[] {
  const innerWidth = Math.max(...stages.map((s) => s.length)) + 2;
  const boxWidth = innerWidth + 2;
  const top = `┌${"─".repeat(innerWidth)}┐`;
  const bottom = `└${"─".repeat(innerWidth)}┘`;
  const connectorColumn = Math.floor(boxWidth / 2);
  const connector = `${" ".repeat(connectorColumn)}│`;
  const arrow = `${" ".repeat(connectorColumn)}▼`;

  const lines: string[] = [];
  stages.forEach((stage, index) => {
    lines.push(top, `│${centerLabel(stage, innerWidth)}│`, bottom);
    if (index < stages.length - 1) lines.push(connector, arrow);
  });
  return lines;
}

export function renderAnalysisReport({ analysis, knowledge, reasoning, elapsedMs }: AnalysisReportInput): string {
  const lines: string[] = [
    ...renderPipelineDiagram(PIPELINE_STAGES),
    "",
    RULE_DOUBLE,
    "ORAM Engineering Analysis",
    RULE_DOUBLE,
    "",
    ...renderRepositorySection(analysis),
    "",
    ...renderKnowledgeSection(analysis, knowledge),
    "",
    ...renderFindingsSection(reasoning),
    "",
    ...renderStatisticsSection(analysis, knowledge, reasoning, elapsedMs),
    "",
    ...renderFooterSection(),
    "",
    RULE_DOUBLE,
  ];
  return lines.join("\n");
}
