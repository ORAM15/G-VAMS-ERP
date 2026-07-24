import StatusBadge from "./StatusBadge";
import TagList from "./TagList";
import { importanceTone, riskTone } from "../../utils/autonomousEngineer";

/**
 * One recommendation's card: priority score, confidence, title, description, impact, risk, reason list,
 * affected modules, and affected files -- every field read directly from recommendations.json, nothing
 * computed or invented on the frontend.
 */
function RecommendationCard({ recommendation }) {
  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Recommendation #{recommendation.id}</p>
          <h3 className="mt-1 text-base font-semibold text-white">{recommendation.title}</h3>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Priority</p>
            <p className="text-2xl font-semibold text-white">{recommendation.priorityScore}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Confidence</p>
            <p className="text-2xl font-semibold text-zinc-300">{recommendation.confidence}%</p>
          </div>
        </div>
      </div>

      <p className="mt-3 text-sm text-zinc-400">{recommendation.description}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <StatusBadge label={`Impact: ${recommendation.estimatedImpact}`} tone={importanceTone(recommendation.estimatedImpact)} />
        <StatusBadge label={`Risk: ${recommendation.estimatedRisk}`} tone={riskTone(recommendation.estimatedRisk)} />
        <StatusBadge label={`Size: ${recommendation.estimatedImplementationSize}`} tone="slate" />
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Reason</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
          {recommendation.reason.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Affected modules</p>
          <div className="mt-2">
            <TagList items={recommendation.affectedModules || []} />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Affected files</p>
          <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-2">
            {(recommendation.affectedFiles || []).length ? (
              recommendation.affectedFiles.map((file) => (
                <p key={file} className="truncate font-mono text-xs text-zinc-400">
                  {file}
                </p>
              ))
            ) : (
              <p className="text-xs text-zinc-500">None</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RecommendationCard;
