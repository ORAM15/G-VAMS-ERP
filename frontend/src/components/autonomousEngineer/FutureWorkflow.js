const FUTURE_STAGES = ["Decision Engine", "Claude Code", "Validation", "Pull Request", "Human Approval"];

/**
 * Section 5 -- Future Workflow. A static, disabled timeline of stages that do not exist yet in this
 * repository (no Decision Engine, no Claude execution, no PR automation are implemented by this phase).
 */
function FutureWorkflow() {
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Future Workflow</h2>
        <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Coming in the next phase</span>
      </div>
      <ol className="glass-panel flex flex-col gap-3 rounded-2xl p-5 opacity-60 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        {FUTURE_STAGES.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <div className="rounded-full border border-dashed border-white/15 px-3 py-1.5 text-xs text-zinc-400">{label}</div>
            {index < FUTURE_STAGES.length - 1 ? <span className="hidden text-zinc-700 sm:inline">&rarr;</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default FutureWorkflow;
