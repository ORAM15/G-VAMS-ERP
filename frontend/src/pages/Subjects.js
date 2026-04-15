import { useEffect, useState } from "react";
import ErpShell from "../components/ErpShell";
import RadarChart from "../components/RadarChart";
import { apiRequest } from "../utils/api";

function Subjects() {
  const [performance, setPerformance] = useState(null);
  const [expandedCode, setExpandedCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadPerformance = async () => {
      try {
        const data = await apiRequest("/performance");

        if (active) {
          setPerformance(data);
          setExpandedCode(data.subjects[0]?.code || "");
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Failed to load performance");
        }
      }
    };

    loadPerformance();

    return () => {
      active = false;
    };
  }, []);

  return (
    <ErpShell
      title="Performance"
      subtitle="Radar insights, exam counts, and marks breakup"
      profileName={performance?.student?.name || "Student"}
      rightSlot={
        <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
          Average {performance?.averagePercentage ?? "--"}%
        </span>
      }
    >
      {error ? <div className="glass-panel mb-6 rounded-[24px] p-5 text-sm text-rose-200">{error}</div> : null}

      <section className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.05fr]">
        <RadarChart data={performance?.radar || []} />

        <div className="glass-panel rounded-[28px] p-6">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-200/70">Summary</p>
          <h2 className="mt-2 text-4xl font-semibold">{performance?.averagePercentage ?? "--"}%</h2>
          <p className="mt-3 text-sm text-zinc-400">Average across all semester subjects with realistic internal and external assessment splits.</p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[22px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Semester</p>
              <p className="mt-2 text-2xl font-semibold">{performance?.student?.semester ?? "--"}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">CGPA</p>
              <p className="mt-2 text-2xl font-semibold">{performance?.student?.cgpa ?? "--"}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        {(performance?.subjects || []).map((subject) => {
          const isOpen = expandedCode === subject.code;

          return (
            <div key={subject.code} className="glass-panel rounded-[26px] p-5">
              <button
                type="button"
                onClick={() => setExpandedCode(isOpen ? "" : subject.code)}
                className="flex w-full items-center justify-between gap-4 text-left"
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{subject.code}</p>
                  <h3 className="mt-2 text-lg font-semibold">{subject.name}</h3>
                  <p className="mt-1 text-sm text-zinc-400">{subject.examCount} exams recorded</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-semibold">{subject.percentage}%</p>
                  <p className="mt-1 text-sm text-zinc-500">Tap to {isOpen ? "collapse" : "expand"}</p>
                </div>
              </button>

              {isOpen ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {subject.marks.map((mark) => (
                    <div key={`${subject.code}-${mark.title}`} className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                      <p className="text-sm text-zinc-400">{mark.title}</p>
                      <p className="mt-2 text-2xl font-semibold">{mark.score}<span className="text-sm text-zinc-500"> / {mark.total}</span></p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </section>
    </ErpShell>
  );
}

export default Subjects;
