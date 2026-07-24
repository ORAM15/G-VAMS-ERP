export const PIPELINE_STAGES = [
  { key: "repositoryAnalysis", label: "Repository Analysis" },
  { key: "engineeringKnowledge", label: "Engineering Knowledge" },
  { key: "recommendations", label: "Recommendations" },
  { key: "decisionEngine", label: "Decision Engine", comingSoon: true },
  { key: "implementation", label: "Implementation", comingSoon: true },
  { key: "validation", label: "Validation", comingSoon: true },
  { key: "pullRequest", label: "Pull Request", comingSoon: true },
];

/**
 * Horizontal (desktop) / stacked (mobile) pipeline stepper. A stage is shown as complete only if its key
 * appears in `completedKeys` -- reflecting whether that stage's generated JSON actually loaded, not a
 * hardcoded assumption -- everything after Recommendations is a fixed "Coming Soon" placeholder per the
 * Phase 4 spec (no Decision Engine / Implementation / Validation / Pull Request stage exists yet).
 */
function PipelineProgress({ completedKeys }) {
  return (
    <ol className="glass-panel flex flex-col gap-3 rounded-2xl p-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
      {PIPELINE_STAGES.map((stage, index) => {
        const isComplete = completedKeys.includes(stage.key);
        return (
          <li key={stage.key} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                isComplete
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                  : stage.comingSoon
                    ? "border-dashed border-white/10 bg-white/[0.03] text-zinc-500"
                    : "border-white/10 bg-white/5 text-zinc-300"
              }`}
            >
              <span aria-hidden="true">{isComplete ? "✓" : stage.comingSoon ? "•" : "○"}</span>
              <span>{stage.label}</span>
              {stage.comingSoon ? <span className="text-[10px] uppercase tracking-wide text-zinc-600">Coming Soon</span> : null}
            </div>
            {index < PIPELINE_STAGES.length - 1 ? <span className="hidden text-zinc-700 sm:inline">&rarr;</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export default PipelineProgress;
