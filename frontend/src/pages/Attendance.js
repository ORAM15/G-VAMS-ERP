import { useEffect, useState } from "react";
import ErpShell from "../components/ErpShell";
import { apiRequest } from "../utils/api";
import { getStatusTone, toneClasses } from "../utils/erp";

function Attendance() {
  const [stats, setStats] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadAttendance = async () => {
      try {
        const [statsData, subjectData] = await Promise.all([
          apiRequest("/attendance/stats"),
          apiRequest("/attendance/subjects"),
        ]);

        if (active) {
          setStats(statsData);
          setSubjects(subjectData);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Failed to load attendance");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadAttendance();

    return () => {
      active = false;
    };
  }, []);

  return (
    <ErpShell
      title="Attendance"
      subtitle="Subject-wise analytics and recovery insights"
      profileName={stats?.student?.name || "Student"}
      rightSlot={<span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">Requirement {stats?.requirement ?? 75}%</span>}
    >
      {loading ? <div className="glass-panel rounded-[24px] p-5 text-sm text-zinc-300">Loading attendance...</div> : null}
      {error ? <div className="glass-panel mb-6 rounded-[24px] p-5 text-sm text-rose-200">{error}</div> : null}

      {stats ? (
        <section className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="glass-panel rounded-[26px] p-5">
            <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Total Classes</p>
            <p className="mt-3 text-4xl font-semibold">{stats.total}</p>
          </div>
          <div className="glass-panel rounded-[26px] p-5">
            <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Present</p>
            <p className="mt-3 text-4xl font-semibold">{stats.present}</p>
          </div>
          <div className="glass-panel rounded-[26px] p-5">
            <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Percentage</p>
            <p className="mt-3 text-4xl font-semibold">{stats.percentage}%</p>
            <p className="mt-2 text-sm text-zinc-400">Absent {stats.absent} classes overall</p>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        {subjects.map((subject) => {
          const tone = getStatusTone(subject.percentage);

          return (
            <div key={subject.code || subject.subject} className="glass-panel rounded-[26px] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{subject.code}</p>
                  <h3 className="mt-2 text-lg font-semibold">{subject.subject}</h3>
                  <p className="mt-1 text-sm text-zinc-400">{subject.presentClasses} / {subject.totalClasses} classes attended</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-semibold">{subject.percentage}%</p>
                  <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs ${toneClasses[tone]}`}>
                    {subject.percentage >= 75 ? "On Track" : "Needs Recovery"}
                  </span>
                </div>
              </div>

              <div className="mt-5 h-2 rounded-full bg-white/8">
                <div className="h-2 rounded-full bg-gradient-to-r from-violet-300 to-fuchsia-400" style={{ width: `${subject.percentage}%` }} />
              </div>

              <p className="mt-4 text-sm text-zinc-400">{subject.statusMessage}</p>
            </div>
          );
        })}
      </section>
    </ErpShell>
  );
}

export default Attendance;
