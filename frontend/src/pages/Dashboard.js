import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpShell from "../components/ErpShell";
import { apiRequest } from "../utils/api";
import { getGreeting, getStatusTone, toneClasses } from "../utils/erp";

function ProgressStat({ label, value, tone }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-zinc-300">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/8">
        <div
          className={`h-2 rounded-full ${
            tone === "rose" ? "bg-rose-400" : "bg-violet-400"
          }`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function CircularIndicator({ percentage }) {
  return (
    <div
      className="flex h-20 w-20 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(#c084fc ${percentage}%, rgba(255,255,255,0.08) ${percentage}% 100%)`,
      }}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0e0b16] text-sm font-semibold">
        {percentage}%
      </div>
    </div>
  );
}

function Dashboard({ currentUser, onLogout }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [timetable, setTimetable] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      try {
        const [statsData, subjectData, timetableData, performanceData] = await Promise.all([
          apiRequest("/attendance/stats"),
          apiRequest("/attendance/subjects"),
          apiRequest("/timetable"),
          apiRequest("/performance"),
        ]);

        if (active) {
          setStats(statsData);
          setSubjects(subjectData);
          setTimetable(timetableData);
          setPerformance(performanceData);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Failed to load dashboard");
        }
      }
    };

    loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  const profile = stats?.student || {};
  const liveClass = timetable?.todaySchedule?.[0];
  const skipPercentage = stats ? Math.max(100 - stats.percentage, 0) : 0;
  const studentName = currentUser?.name || profile.name || "Student";

  return (
    <ErpShell
      title={`${getGreeting()}, ${studentName}`}
      subtitle={profile.department || "Virtual Attendance Management System"}
      profileName={studentName}
      rightSlot={
        <div className="hidden items-center gap-2 sm:flex">
          <button type="button" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
            Alerts
          </button>
          <button type="button" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
            Inbox
          </button>
          <button
            type="button"
            onClick={() => {
              onLogout();
              navigate("/", { replace: true });
            }}
            className="rounded-full border border-rose-300/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-100"
          >
            Logout
          </button>
        </div>
      }
    >
      {error ? (
        <div className="glass-panel mb-6 rounded-[24px] p-5 text-sm text-rose-200">{error}</div>
      ) : null}

      <section className="mb-6 grid gap-6 lg:grid-cols-[1.25fr_0.95fr]">
        <div className="glass-panel rounded-[28px] p-6">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-violet-200/70">Student Summary</p>
              <h2 className="mt-2 text-2xl font-semibold">{studentName}</h2>
              <p className="mt-1 text-sm text-zinc-400">
                {profile.studentId || currentUser?.studentId || "GVAMS"} • Semester {profile.semester || "--"} • Section {profile.section || "--"}
              </p>
            </div>
            <div className="rounded-[22px] border border-violet-300/20 bg-violet-500/10 px-5 py-4 text-right">
              <p className="text-xs uppercase tracking-[0.24em] text-violet-200/70">CGPA</p>
              <p className="mt-2 text-4xl font-semibold text-violet-100">
                {profile.cgpa || "--"}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Messages", route: "/leave" },
              { label: "Prediction", route: "/subjects" },
              { label: "Date Sheet", route: "/timetable" },
              { label: "Leaves", route: "/leave" },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => navigate(action.route)}
                className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:bg-white/10"
              >
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{action.label}</p>
                <p className="mt-3 text-sm text-zinc-200">Open module</p>
              </button>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-[28px] p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-violet-200/70">Live Class</p>
              <h3 className="mt-2 text-xl font-semibold">{liveClass?.subject || "No live class yet"}</h3>
              <p className="mt-1 text-sm text-zinc-400">
                {liveClass ? `${liveClass.teacher} • ${liveClass.time}` : "Your next session will appear here"}
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
              {liveClass?.room || "Room TBA"}
            </span>
          </div>

          <div className="mb-6 rounded-[24px] border border-white/8 bg-black/20 p-4">
            <p className="text-sm text-zinc-300">{liveClass?.tag || "Lecture"} with attendance insight</p>
          </div>

          <div className="space-y-4">
            <ProgressStat label="Attend %" value={stats?.percentage || 0} tone="violet" />
            <ProgressStat label="Skip %" value={skipPercentage} tone="rose" />
          </div>
        </div>
      </section>

      <section className="mb-6 grid gap-6 md:grid-cols-3">
        <div className="glass-panel rounded-[26px] p-5">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Attendance</p>
          <p className="mt-3 text-3xl font-semibold">{stats?.percentage ?? "--"}%</p>
          <p className="mt-2 text-sm text-zinc-400">
            {stats ? `${stats.present}/${stats.total} classes marked present` : "Loading attendance"}
          </p>
        </div>
        <div className="glass-panel rounded-[26px] p-5">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Performance</p>
          <p className="mt-3 text-3xl font-semibold">{performance?.averagePercentage ?? "--"}%</p>
          <p className="mt-2 text-sm text-zinc-400">Average score across current semester</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/attendance")}
          className="glass-panel rounded-[26px] p-5 text-left transition hover:bg-white/[0.09]"
        >
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Attendance Analytics</p>
          <p className="mt-3 text-xl font-semibold">Open detailed subject insights</p>
          <p className="mt-2 text-sm text-zinc-400">View recovery status, classes present, and subject-by-subject trends.</p>
        </button>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-violet-200/70">Subjects</p>
            <h3 className="mt-1 text-2xl font-semibold">Current semester overview</h3>
          </div>
          <button
            type="button"
            onClick={() => navigate("/subjects")}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300"
          >
            Open Performance
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {subjects.map((subject) => {
            const tone = getStatusTone(subject.percentage);

            return (
              <div key={subject.code || subject.subject} className="glass-panel rounded-[26px] p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-lg font-semibold">{subject.subject}</h4>
                    <p className="mt-1 text-sm text-zinc-400">
                      {subject.code} • {subject.credits} credits • Leaves {subject.leavesRemaining}
                    </p>
                  </div>
                  <CircularIndicator percentage={subject.percentage} />
                </div>

                <div className={`mt-5 inline-flex rounded-full border px-3 py-1 text-xs ${toneClasses[tone]}`}>
                  {subject.statusMessage}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </ErpShell>
  );
}

export default Dashboard;
