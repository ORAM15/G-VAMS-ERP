import { useAutonomousEngineerData, DATA_SOURCES } from "../utils/autonomousEngineer";
import PipelineProgress from "../components/autonomousEngineer/PipelineProgress";
import RepositoryOverview from "../components/autonomousEngineer/RepositoryOverview";
import EngineeringKnowledgeSection from "../components/autonomousEngineer/EngineeringKnowledgeSection";
import RecommendationsSection from "../components/autonomousEngineer/RecommendationsSection";
import FutureWorkflow from "../components/autonomousEngineer/FutureWorkflow";

function DataNotice({ label, generator }) {
  return (
    <div className="glass-panel rounded-2xl p-5 text-sm text-amber-200">
      {label} has not been generated yet. Run{" "}
      <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs text-amber-100">{generator}</code> and reload this page.
    </div>
  );
}

/**
 * The Autonomous Engineer Dashboard (route: /autonomous-engineer). A read-only visualization of the
 * deterministic Repository Intelligence / Engineering Knowledge / Recommendation Engine pipeline. It never
 * computes repository data itself -- it only fetches and renders the three JSON files those engines already
 * produced (see frontend/src/utils/autonomousEngineer.js and frontend/scripts/sync-autonomous-data.js).
 */
function AutonomousEngineer() {
  const { loading, repositoryAnalysis, engineeringKnowledge, recommendations, errors } = useAutonomousEngineerData();
  const loaded = { repositoryAnalysis, engineeringKnowledge, recommendations };
  const completedKeys = DATA_SOURCES.map((source) => source.key).filter((key) => Boolean(loaded[key]));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">G-VAMS Autonomous Engineering System</p>
          <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Autonomous Engineer Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            A read-only visualization of the deterministic Repository Intelligence, Engineering Knowledge, and Recommendation pipeline.
          </p>
        </header>

        <div className="flex flex-col gap-8">
          <PipelineProgress completedKeys={completedKeys} />

          {loading ? <div className="glass-panel rounded-2xl p-5 text-sm text-zinc-400">Loading pipeline data...</div> : null}

          {!loading && errors.repositoryAnalysis ? <DataNotice label="Repository analysis" generator="node scripts/repository-intelligence.js" /> : null}
          {!loading && repositoryAnalysis ? <RepositoryOverview analysis={repositoryAnalysis} /> : null}

          {!loading && errors.engineeringKnowledge ? <DataNotice label="Engineering knowledge" generator="node scripts/engineering-knowledge.js" /> : null}
          {!loading && engineeringKnowledge ? <EngineeringKnowledgeSection knowledge={engineeringKnowledge} /> : null}

          {!loading && errors.recommendations ? <DataNotice label="Recommendations" generator="node scripts/recommendation-engine.js" /> : null}
          {!loading && recommendations ? <RecommendationsSection report={recommendations} /> : null}

          <FutureWorkflow />
        </div>
      </div>
    </div>
  );
}

export default AutonomousEngineer;
