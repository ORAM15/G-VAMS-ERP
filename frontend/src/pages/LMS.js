import { useEffect, useState } from "react";
import ErpShell from "../components/ErpShell";
import { apiRequest } from "../utils/api";

function LMS() {
  const [selectedSemester, setSelectedSemester] = useState(1);
  const [subjects, setSubjects] = useState([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const stats = await apiRequest("/attendance/stats");

        if (active) {
          setSelectedSemester(stats.student?.semester || 1);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Failed to load LMS");
        }
      }
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadSemester = async () => {
      try {
        const data = await apiRequest(`/lms/${selectedSemester}`);

        if (active) {
          setSubjects(data.subjects || []);
          const firstCode = data.subjects?.[0]?.code || "";
          setSelectedCode(firstCode);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Failed to load LMS subjects");
        }
      }
    };

    loadSemester();

    return () => {
      active = false;
    };
  }, [selectedSemester]);

  useEffect(() => {
    let active = true;

    const loadSubject = async () => {
      if (!selectedCode) {
        return;
      }

      try {
        const data = await apiRequest(`/lms/${selectedCode}`);

        if (active) {
          setDetail(data);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Failed to load LMS detail");
        }
      }
    };

    loadSubject();

    return () => {
      active = false;
    };
  }, [selectedCode]);

  return (
    <ErpShell
      title="LMS"
      subtitle="Syllabus, notes, assignments, and course materials"
      profileName={detail?.name || "Student"}
      rightSlot={
        <select
          value={selectedSemester}
          onChange={(event) => setSelectedSemester(Number(event.target.value))}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
        >
          {[1, 2, 3, 4, 5, 6].map((semester) => (
            <option key={semester} value={semester} className="bg-[#15111f]">
              Semester {semester}
            </option>
          ))}
        </select>
      }
    >
      {error ? <div className="glass-panel mb-6 rounded-[24px] p-5 text-sm text-rose-200">{error}</div> : null}

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="glass-panel rounded-[28px] p-5">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.22em] text-violet-200/70">Subjects</p>
            <h2 className="mt-2 text-2xl font-semibold">Semester {selectedSemester}</h2>
          </div>

          <div className="space-y-3">
            {subjects.map((subject) => (
              <button
                key={subject.code}
                type="button"
                onClick={() => setSelectedCode(subject.code)}
                className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                  selectedCode === subject.code
                    ? "border-violet-300/30 bg-violet-500/15"
                    : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{subject.code}</p>
                <h3 className="mt-2 text-base font-semibold">{subject.name}</h3>
                <p className="mt-1 text-sm text-zinc-400">{subject.teacher} • {subject.credits} credits</p>
              </button>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-[28px] p-6">
          {detail ? (
            <>
              <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-violet-200/70">Selected Subject</p>
                  <h2 className="mt-2 text-2xl font-semibold">{detail.name}</h2>
                  <p className="mt-1 text-sm text-zinc-400">{detail.code} • {detail.teacher}</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
                  {detail.credits} credits
                </span>
              </div>

              <div className="mb-6 rounded-[24px] border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-medium text-violet-200">Syllabus</p>
                <p className="mt-3 text-sm leading-6 text-zinc-300">{detail.syllabus}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
                  <p className="text-sm font-medium text-violet-200">Notes</p>
                  <div className="mt-4 space-y-3 text-sm text-zinc-300">
                    {detail.notes.map((item) => (
                      <a key={item.url} href={item.url} target="_blank" rel="noreferrer" className="block rounded-[18px] border border-white/10 bg-black/20 px-3 py-3 hover:bg-black/30">
                        {item.title}
                      </a>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
                  <p className="text-sm font-medium text-violet-200">Assignments</p>
                  <div className="mt-4 space-y-3 text-sm text-zinc-300">
                    {detail.assignments.map((item) => (
                      <div key={`${item.title}-${item.dueDate}`} className="rounded-[18px] border border-white/10 bg-black/20 px-3 py-3">
                        <p>{item.title}</p>
                        <p className="mt-1 text-xs text-zinc-500">Due {item.dueDate} • {item.status}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-medium text-violet-200">Course Materials</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {detail.courseMaterials.map((item) => (
                    <div key={item.title} className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-4">
                      <p className="font-medium">{item.title}</p>
                      <p className="mt-2 text-sm text-zinc-400">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-zinc-300">Select a subject to open materials.</div>
          )}
        </div>
      </section>
    </ErpShell>
  );
}

export default LMS;
