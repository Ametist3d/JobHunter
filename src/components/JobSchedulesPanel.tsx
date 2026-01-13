import React, { useEffect, useState } from "react";
import JobScheduleModal, { type JobScheduleFormData } from "../components/JobScheduleModal";
import type { SearchProvider } from "../api";

type JobSchedule = {
  id: string;
  region: string;
  position: string;
  marketDomain: string;
  providers: SearchProvider[];
  intervalHours: number;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  consecutiveEmptyRuns?: number;
  disabledReason?: string;
  lastRunStats?: { found: number; prefiltered: number; withEmail: number; sent: number; failed: number };
  applicant: { fullName: string; coverLetterBase: string };
};

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "gem",
  deepseek: "ds",
  perplexity: "ppl",
};

const toFormData = (s: JobSchedule): Partial<JobScheduleFormData> => ({
  ...s,
  // normalize null -> undefined for the form
  nextRunAt: s.nextRunAt ?? undefined,
});

export default function JobSchedulesPanel() {
  const [schedules, setSchedules] = useState<JobSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<JobSchedule | null>(null);

  async function loadData() {
    try {
      const res = await fetch("/api/job-schedules");
      const d = await res.json();
      setSchedules(d.schedules || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSave(data: JobScheduleFormData) {
    const payload = {
      ...data,
      id: editingSchedule?.id,
      enabled: editingSchedule?.enabled ?? true,
    };

    const res = await fetch("/api/job-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const d = await res.json();
    if (d.ok) {
      if (editingSchedule) {
        setSchedules((prev) => prev.map((s) => (s.id === d.schedule.id ? d.schedule : s)));
      } else {
        setSchedules((prev) => [...prev, d.schedule]);
      }
      setModalOpen(false);
      setEditingSchedule(null);
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    const schedule = schedules.find((s) => s.id === id);
    if (!schedule) return;

    await fetch("/api/job-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...schedule, enabled }),
    });
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  }

  async function runNow(id: string) {
    await fetch(`/api/job-schedules/${id}/run-now`, { method: "POST" });
    alert("Job search started in background!");
  }

  async function deleteSchedule(id: string) {
    if (!confirm("Delete this schedule?")) return;
    await fetch(`/api/job-schedules/${id}`, { method: "DELETE" });
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  }

  if (loading) return <div className="text-slate-400 p-4">Loading schedules...</div>;

  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Scheduled Campaigns</h3>
          <p className="text-xs text-slate-400 mt-1">
            Auto-runs every 5 min check • Disables after 3 consecutive empty runs
          </p>
        </div>
        <button
          onClick={() => { setEditingSchedule(null); setModalOpen(true); }}
          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
        >
          + Add Schedule
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="text-sm text-slate-400 p-8 text-center border border-dashed border-slate-700 rounded-xl">
          No schedules yet. Click "Add Schedule" to create one.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Region</th>
                <th className="px-3 py-2 text-left">Position</th>
                <th className="px-3 py-2 text-left">Providers</th>
                <th className="px-3 py-2 text-left">Interval</th>
                <th className="px-3 py-2 text-left">Next Run</th>
                <th className="px-3 py-2 text-left">Last Stats</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => {
                const statusColor = s.enabled
                  ? "text-emerald-400"
                  : s.disabledReason === "empty_results"
                    ? "text-amber-400"
                    : "text-slate-500";

                return (
                  <tr key={s.id} className="border-t border-slate-800 hover:bg-slate-900/30">
                    <td className="px-3 py-3 font-medium">{s.region}</td>
                    <td className="px-3 py-3 text-slate-300">{s.position}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {s.providers.map((p) => (
                          <span
                            key={p}
                            className="px-1.5 py-0.5 rounded text-xs bg-slate-800 text-slate-300"
                          >
                            {PROVIDER_LABELS[p] || p}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-300">{s.intervalHours}h</td>
                    <td className="px-3 py-3 text-xs text-slate-400">
                      {s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {s.lastRunStats ? (
                        <span>
                          <span className="text-emerald-300">{s.lastRunStats.sent}</span>
                          <span className="text-slate-500"> / </span>
                          <span className="text-slate-300">{s.lastRunStats.found}</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className={`px-3 py-3 text-xs font-medium ${statusColor}`}>
                      {s.enabled ? "Active" : s.disabledReason === "empty_results" ? "Paused" : "Off"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => toggleEnabled(s.id, !s.enabled)}
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            s.enabled ? "bg-emerald-600 text-white" : "bg-slate-700 text-slate-300"
                          }`}
                        >
                          {s.enabled ? "On" : "Off"}
                        </button>
                        <button
                          onClick={() => runNow(s.id)}
                          className="px-2 py-1 rounded bg-amber-500 text-slate-950 text-xs font-medium hover:bg-amber-400"
                          title="Run now"
                        >
                          ▶
                        </button>
                        <button
                          onClick={() => { setEditingSchedule(s); setModalOpen(true); }}
                          className="px-2 py-1 rounded bg-slate-700 text-slate-200 text-xs hover:bg-slate-600"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => deleteSchedule(s.id)}
                          className="px-2 py-1 rounded bg-red-900/50 text-red-300 text-xs hover:bg-red-900"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <JobScheduleModal
        open={modalOpen}
        initialData={editingSchedule ? toFormData(editingSchedule) : undefined}
        onClose={() => { setModalOpen(false); setEditingSchedule(null); }}
        onSave={handleSave}
      />
    </div>
  );
}