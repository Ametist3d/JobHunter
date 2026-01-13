import React from "react";
import type { JobLead } from "../api";

export default function LeadTable({ leads }: { leads: JobLead[] }) {
  if (leads.length === 0) {
    return <div className="p-6 text-sm text-slate-400">No companies found yet.</div>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800">
      <div className="max-h-[320px] overflow-auto bg-slate-950/30">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-950/70 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3 w-8">✓</th>
              <th className="px-4 py-3">Company / Website</th>
              <th className="px-4 py-3">Job Title</th>
              <th className="px-4 py-3">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l, idx) => (
              <tr key={idx} className="border-t border-slate-800/70">
                <td className="px-4 py-3">
                  {l.vacancyConfirmed ? (
                    <span className="text-emerald-400" title="Vacancy confirmed">✓</span>
                  ) : (
                    <span className="text-slate-500" title="Unconfirmed">?</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div>
                    <a href={l.website} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">
                      {l.companyName || l.website}
                    </a>
                  </div>
                  {l.companyName && (
                    <div className="text-xs text-slate-500">{l.website}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-200">
                  {l.jobTitle || <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 max-w-[200px] truncate">
                  {l.snippet?.slice(0, 100) || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}