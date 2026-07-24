import TagList from "./TagList";

function StatTile({ label, value, hint }) {
  return (
    <div className="glass-panel rounded-2xl p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className="mt-2 truncate text-3xl font-semibold text-white">{value}</p>
      {hint ? <p className="mt-1 text-sm text-zinc-400">{hint}</p> : null}
    </div>
  );
}

/**
 * Section 2 -- Repository Overview. Reads only repository-analysis.json (Repository Intelligence v1's
 * output): project name, languages, frameworks, package managers, modules detected, dependency count.
 */
function RepositoryOverview({ analysis }) {
  const detectedModules = analysis.detectedModules || [];
  const detectedCount = detectedModules.filter((module) => module.detected).length;
  const packageManagerLabels = [...new Set((analysis.packageManagers || []).map((entry) => entry.manager))];
  const dependencyHint = Object.entries(analysis.dependencyCount?.perWorkspace || {})
    .map(([workspace, count]) => `${workspace}: ${count}`)
    .join(" · ");

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-white">Repository Overview</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Project" value={analysis.projectName} />
        <StatTile label="Modules Detected" value={`${detectedCount}/${detectedModules.length}`} />
        <StatTile label="Dependencies" value={analysis.dependencyCount?.total ?? 0} hint={dependencyHint || undefined} />
        <StatTile label="Files" value={analysis.fileCount ?? "—"} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="glass-panel rounded-2xl p-5">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-zinc-500">Languages</p>
          <TagList items={(analysis.languages || []).map((entry) => `${entry.language} (${entry.fileCount})`)} emptyLabel="No languages detected" />
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-zinc-500">Frameworks</p>
          <TagList items={analysis.frameworks || []} emptyLabel="No frameworks detected" />
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-zinc-500">Package Managers</p>
          <TagList items={packageManagerLabels} emptyLabel="No package managers detected" />
        </div>
      </div>
    </section>
  );
}

export default RepositoryOverview;
