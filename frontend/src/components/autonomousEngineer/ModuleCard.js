import StatusBadge from "./StatusBadge";
import TagList from "./TagList";
import { importanceTone, riskTone } from "../../utils/autonomousEngineer";

/**
 * One module's card in the Engineering Knowledge section: name, business purpose, criticality, complexity,
 * maintenance risk, and related (coupled) modules. Undetected modules are shown de-emphasized with an
 * explicit "Not detected" badge rather than omitted, matching Engineering Knowledge Engine v1's own honest
 * reporting for modules it evaluated but did not find evidence of.
 */
function ModuleCard({ module }) {
  return (
    <div className={`glass-panel rounded-2xl p-5 ${module.detected ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-white">{module.name}</h3>
        {!module.detected ? <StatusBadge label="Not detected" tone="slate" /> : null}
      </div>

      <p className="mt-2 text-sm text-zinc-400">{module.businessPurpose}</p>

      {module.detected ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge label={`Criticality: ${module.businessCriticality}`} tone={importanceTone(module.businessCriticality)} />
            <StatusBadge label={`Complexity: ${module.estimatedComplexity}`} tone={riskTone(module.estimatedComplexity)} />
            <StatusBadge label={`Risk: ${module.estimatedMaintenanceRisk}`} tone={riskTone(module.estimatedMaintenanceRisk)} />
          </div>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Related modules</p>
            <div className="mt-2">
              <TagList items={module.coupledModules || []} emptyLabel="None" />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default ModuleCard;
