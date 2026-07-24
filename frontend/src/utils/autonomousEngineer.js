import { useEffect, useState } from "react";

// Tailwind class strings for each semantic "tone" used across the Autonomous Engineer Dashboard's badges.
// Kept separate from the ERP app's own `toneClasses` (frontend/src/utils/erp.js) since that one encodes
// attendance-percentage semantics, not risk/importance semantics.
export const TONE_CLASSES = {
  rose: "text-rose-200 bg-rose-500/10 border-rose-400/25",
  amber: "text-amber-200 bg-amber-500/10 border-amber-400/25",
  emerald: "text-emerald-200 bg-emerald-500/10 border-emerald-400/25",
  violet: "text-violet-200 bg-violet-500/10 border-violet-400/25",
  slate: "text-slate-300 bg-slate-500/10 border-slate-400/20",
};

/**
 * Maps a Low/Medium/High/"Not applicable" level where High is a concern (risk, complexity) to a badge tone.
 * @param {string} level
 * @returns {keyof TONE_CLASSES}
 */
export function riskTone(level) {
  if (level === "High") return "rose";
  if (level === "Medium") return "amber";
  if (level === "Low") return "emerald";
  return "slate";
}

/**
 * Maps a Low/Medium/High/"Not applicable" level where High is notable-but-not-bad (criticality,
 * architectural importance, business impact) to a badge tone.
 * @param {string} level
 * @returns {keyof TONE_CLASSES}
 */
export function importanceTone(level) {
  if (level === "High") return "violet";
  if (level === "Medium") return "amber";
  if (level === "Low") return "slate";
  return "slate";
}

// The three Phase 3 engine outputs this dashboard reads, and nothing else. Each is fetched as a plain
// static asset from frontend/public/autonomous-engineer-data/ (see frontend/scripts/sync-autonomous-
// data.js), never computed or re-derived by the dashboard itself.
export const DATA_SOURCES = [
  { key: "repositoryAnalysis", file: "repository-analysis.json", label: "Repository analysis", generator: "node scripts/repository-intelligence.js" },
  { key: "engineeringKnowledge", file: "engineering-knowledge.json", label: "Engineering knowledge", generator: "node scripts/engineering-knowledge.js" },
  { key: "recommendations", file: "recommendations.json", label: "Recommendations", generator: "node scripts/recommendation-engine.js" },
];

/**
 * Loads the three generated JSON artifacts the Autonomous Engineer Dashboard visualizes. Each source is
 * fetched independently, so one missing/invalid file (e.g. an engine that hasn't been run yet) never blocks
 * the others -- the caller receives per-source data and a per-source error message to render inline.
 * @returns {{loading: boolean, repositoryAnalysis: object|null, engineeringKnowledge: object|null, recommendations: object|null, errors: Record<string,string>}}
 */
export function useAutonomousEngineerData() {
  const [state, setState] = useState({
    loading: true,
    repositoryAnalysis: null,
    engineeringKnowledge: null,
    recommendations: null,
    errors: {},
  });

  useEffect(() => {
    let active = true;

    async function loadSource(source) {
      const url = `${process.env.PUBLIC_URL}/autonomous-engineer-data/${source.file}`;
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`not generated yet -- run \`${source.generator}\``);
        return { key: source.key, data: await response.json(), error: null };
      } catch (error) {
        return { key: source.key, data: null, error: error.message };
      }
    }

    Promise.all(DATA_SOURCES.map(loadSource)).then((results) => {
      if (!active) return;
      const next = { loading: false, repositoryAnalysis: null, engineeringKnowledge: null, recommendations: null, errors: {} };
      for (const result of results) {
        next[result.key] = result.data;
        if (result.error) next.errors[result.key] = result.error;
      }
      setState(next);
    });

    return () => {
      active = false;
    };
  }, []);

  return state;
}
