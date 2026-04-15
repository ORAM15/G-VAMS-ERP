import { useEffect, useState } from "react";
import ErpShell from "../components/ErpShell";
import { apiRequest } from "../utils/api";

function Leave() {
  const [form, setForm] = useState({
    startDate: "",
    duration: "",
    reason: "",
    description: "",
  });
  const [stats, setStats] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      try {
        const [statsData, performanceData, leaveData] = await Promise.all([
          apiRequest("/attendance/stats"),
          apiRequest("/performance"),
          apiRequest("/leave"),
        ]);

        if (active) {
          setStats(statsData);
          setPerformance(performanceData);
          setHistory(leaveData);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Failed to load analytics");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      active = false;
    };
  }, []);

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const newLeave = await apiRequest("/leave", {
        method: "POST",
        body: JSON.stringify(form),
      });

      setHistory((current) => [newLeave, ...current]);
      setForm({
        startDate: "",
        duration: "",
        reason: "",
        description: "",
      });
    } catch (submitError) {
      setError(submitError.message || "Failed to submit leave request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ErpShell
      title="Analytics & Profile"
      subtitle="Profile snapshot, attendance trend, and leave management"
      profileName={stats?.student?.name || "Student"}
      rightSlot={<span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">{stats?.student?.section || "--"}</span>}
    >
      {error ? <div className="glass-panel mb-6 rounded-[24px] p-5 text-sm text-rose-200">{error}</div> : null}
      {loading ? <div className="glass-panel mb-6 rounded-[24px] p-5 text-sm text-zinc-300">Loading profile...</div> : null}

      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="glass-panel rounded-[26px] p-5 md:col-span-2">
          <p className="text-xs uppercase tracking-[0.22em] text-violet-200/70">Profile</p>
          <h2 className="mt-2 text-2xl font-semibold">{stats?.student?.name || "Student"}</h2>
          <p className="mt-1 text-sm text-zinc-400">
            {stats?.student?.studentId || "GVAMS"} • Semester {stats?.student?.semester || "--"} • {stats?.student?.department || "Department"}
          </p>
        </div>
        <div className="glass-panel rounded-[26px] p-5">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Average %</p>
          <p className="mt-3 text-4xl font-semibold">{performance?.averagePercentage ?? "--"}</p>
          <p className="mt-2 text-sm text-zinc-400">Current academic average</p>
        </div>
      </section>

      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="glass-panel rounded-[26px] p-5">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Attendance %</p>
          <p className="mt-3 text-3xl font-semibold">{stats?.percentage ?? "--"}%</p>
        </div>
        <div className="glass-panel rounded-[26px] p-5">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Approved Leaves</p>
          <p className="mt-3 text-3xl font-semibold">{history.filter((item) => item.status === "Approved").length}</p>
        </div>
        <div className="glass-panel rounded-[26px] p-5">
          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Pending Leaves</p>
          <p className="mt-3 text-3xl font-semibold">{history.filter((item) => item.status === "Pending").length}</p>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="glass-panel rounded-[28px] p-6">
          <p className="text-xs uppercase tracking-[0.22em] text-violet-200/70">Request Leave</p>
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <input type="date" name="startDate" value={form.startDate} onChange={handleChange} className="w-full rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 outline-none" />
            <input type="number" name="duration" placeholder="Duration (days)" value={form.duration} onChange={handleChange} className="w-full rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 outline-none" />
            <select name="reason" value={form.reason} onChange={handleChange} className="w-full rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 outline-none">
              <option value="" className="bg-[#15111f]">Select Reason</option>
              <option className="bg-[#15111f]">Medical</option>
              <option className="bg-[#15111f]">Personal</option>
              <option className="bg-[#15111f]">Academic</option>
            </select>
            <textarea name="description" placeholder="Description" value={form.description} onChange={handleChange} className="min-h-28 w-full rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 outline-none" />
            <button disabled={submitting} className="w-full rounded-[18px] bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-3 font-medium text-white disabled:opacity-70">
              {submitting ? "Submitting..." : "Submit Leave Request"}
            </button>
          </form>
        </div>

        <div className="glass-panel rounded-[28px] p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-violet-200/70">Leave History</p>
              <h3 className="mt-2 text-2xl font-semibold">Recent requests</h3>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">{history.length} records</span>
          </div>

          <div className="space-y-3">
            {history.map((item) => (
              <div key={item._id} className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.reason}</p>
                    <p className="mt-1 text-sm text-zinc-400">{item.duration} day(s) • {new Date(item.startDate).toLocaleDateString()}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs ${
                    item.status === "Approved"
                      ? "bg-emerald-500/10 text-emerald-200"
                      : item.status === "Pending"
                      ? "bg-amber-500/10 text-amber-200"
                      : "bg-rose-500/10 text-rose-200"
                  }`}>
                    {item.status}
                  </span>
                </div>
                {item.description ? <p className="mt-3 text-sm text-zinc-400">{item.description}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </ErpShell>
  );
}

export default Leave;
