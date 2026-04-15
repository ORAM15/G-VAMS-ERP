import { useEffect, useMemo, useState } from "react";
import ErpShell from "../components/ErpShell";
import { apiRequest } from "../utils/api";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Timetable() {
  const [timetable, setTimetable] = useState(null);
  const [selectedDay, setSelectedDay] = useState("Mon");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadTimetable = async () => {
      try {
        const data = await apiRequest("/timetable");

        if (active) {
          setTimetable(data);
          setSelectedDay(data.today || "Mon");
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Failed to load timetable");
        }
      }
    };

    loadTimetable();

    return () => {
      active = false;
    };
  }, []);

  const classes = useMemo(() => {
    if (!timetable) {
      return [];
    }

    return timetable.week.find((entry) => entry.day === selectedDay)?.classes || [];
  }, [selectedDay, timetable]);

  return (
    <ErpShell
      title="Timetable"
      subtitle={timetable?.dateLabel || "Today and weekly schedule"}
      profileName={timetable?.student?.name || "Student"}
      rightSlot={<span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">{selectedDay}</span>}
    >
      {error ? <div className="glass-panel mb-6 rounded-[24px] p-5 text-sm text-rose-200">{error}</div> : null}

      <section className="mb-6 glass-panel rounded-[28px] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-violet-200/70">Today</p>
            <h2 className="mt-2 text-2xl font-semibold">{timetable?.dateLabel || "Loading timetable"}</h2>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
            Semester {timetable?.student?.semester ?? "--"} • {timetable?.student?.section ?? "--"}
          </span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {DAY_LABELS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(day)}
              className={`rounded-full px-4 py-3 text-sm transition ${
                selectedDay === day
                  ? "bg-violet-500/20 text-white"
                  : "bg-white/5 text-zinc-400 hover:text-white"
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        {classes.map((item) => (
          <div key={`${selectedDay}-${item.time}-${item.subjectCode}`} className="glass-panel rounded-[26px] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{item.subjectCode}</p>
                <h3 className="mt-2 text-xl font-semibold">{item.subject}</h3>
                <p className="mt-2 text-sm text-zinc-400">{item.teacher} • {item.room}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold">{item.time}</p>
                <span className="mt-2 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
                  {item.tag}
                </span>
              </div>
            </div>
          </div>
        ))}
      </section>
    </ErpShell>
  );
}

export default Timetable;
