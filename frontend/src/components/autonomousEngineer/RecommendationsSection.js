import RecommendationCard from "./RecommendationCard";

/**
 * Section 4 -- Recommendations. Reads only recommendations.json (Recommendation Engine v1's output),
 * displayed sorted by descending priority score (the engine already sorts its output this way; sorting
 * again here is a cheap, purely defensive re-application of the same rule, not a new derivation).
 */
function RecommendationsSection({ report }) {
  const recommendations = [...(report.recommendations || [])].sort(
    (a, b) => b.priorityScore - a.priorityScore || b.confidence - a.confidence
  );

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-white">Recommendations</h2>
      {recommendations.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {recommendations.map((recommendation) => (
            <RecommendationCard key={recommendation.id} recommendation={recommendation} />
          ))}
        </div>
      ) : (
        <p className="glass-panel rounded-2xl p-5 text-sm text-zinc-400">No recommendations were triggered by the current engineering knowledge.</p>
      )}
    </section>
  );
}

export default RecommendationsSection;
